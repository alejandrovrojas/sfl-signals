// sfl-signals
// 0.1.0
//
// dependency-free signals implementation that uses weakref for handling garbage
// collected referenced. all operations are internally batched to prevent cascading
// updates during (synchronous) mutations.
//
// USAGE
//     import { signal, computed, effect, batch } from './signals';
//
//     // basic signal
//     const count = signal(0);
//     count.value = 5;
//     console.log(count.value); // 5
//
//     // computed values
//     const doubled = computed(() => count.value * 2);
//     console.log(doubled.value); // 10
//
//     // side effects
//     const dispose = effect(() => {
//         console.log(`count is ${count.value}`);
//     });
//
//     // batched updates
//     batch(() => {
//         count.value = 10;
//         count.value = 20; // only one effect execution
//     });
//
//     // cleanup
//     dispose();

interface ReadonlySignal<T> {
	peek(): T;
	readonly value: T;
}

const processing = {
	signals:       new Set<Signal<unknown>>(),       // signals accessed during current batch
	computed:      null as Computed<unknown> | null, // currently executing computed
	batch_effects: null as Set<() => void> | null,   // effects to run after batch
}

export class Signal<T> {
	protected _value:      T;
	protected _dependents: Set<WeakRef<Signal<unknown>>> = new Set();

	constructor(value: T) {
		this._value = value;
	}

	protected _mark_for_update() {
		this._dependents.forEach(dependent_ref => {
			const dependent = dependent_ref.deref();

			if (dependent) {
				dependent._mark_for_update();
			} else {
				this._dependents.delete(dependent_ref);
			}
		});
	}

	public peek(): T {
		return this._value;
	}

	public get value(): T {
		const value = this._value;

		if (processing.computed !== null) {
			if (processing.batch_effects !== null) {
				processing.signals.add(this);
			}

			processing.computed._add_dependency(this, value);
		}

		return value;
	}

	public set value(value: T) {
		if (
			processing.computed !== null &&
			processing.batch_effects !== null &&
			processing.signals.has(this)
		) {
			throw new Error('Cycle detected');
		}

		if (value === this._value) {
			return;
		}

		this._value = value;

		batch(() => {
			this._mark_for_update();
		});
	}
}

export class Computed<T> extends Signal<T> implements ReadonlySignal<T> {
	protected _ref:          WeakRef<this>                 = new WeakRef(this);
	protected _first:        boolean                       = true;
	protected _must_update:  boolean                       = true;
	protected _error:        unknown                       = undefined; // cached thrown value
	protected _has_error:    boolean                       = false;     // whether _error is valid
	protected _dependencies: Map<Signal<unknown>, unknown> = new Map();
	protected _callback:     () => T;

	constructor(callback: () => T) {
		super(undefined as unknown as T);
		this._callback = callback;
	}

	protected _mark_for_update() {
		this._must_update = true;
		super._mark_for_update();
	}

	public _add_dependency(accessed_signal: Signal<unknown>, value: unknown) {
		this._dependencies.set(accessed_signal, value);
		(accessed_signal as any)._dependents.add(this._ref);
	}

	protected _remove_dependencies() {
		this._dependencies.forEach((_value, parent) => {
			(parent as any)._dependents.delete(this._ref);
		});

		this._dependencies.clear();
	}

	public peek(): T {
		if (this._must_update) {
			this._must_update = false;

			let changed = false;

			if (this._first) {
				this._first = false;
				changed     = true;
			} else {
				for (const [parent, oldValue] of this._dependencies) {
					try {
						if (parent.peek() !== oldValue) {
							changed = true;
							break;
						}
					} catch {
						changed = true;
						break;
					}
				}
			}

			if (changed) {
				this._remove_dependencies();

				const old          = processing.computed;
				processing.computed = this;

				try {
					this._value     = this._callback();
					this._has_error = false;
				} catch (e) {
					this._error     = e;
					this._has_error = true;
				} finally {
					processing.computed = old;
				}
			}
		}

		if (this._has_error) {
			throw this._error;
		}

		return this._value;
	}

	public get value(): T {
		const value = this.peek();

		if (processing.computed !== null) {
			processing.computed._add_dependency(this, value);
		}

		return value;
	}

	public set value(v: T) {
		throw new Error('Computed signals are readonly');
	}
}

class Effect {
	private _ref:          WeakRef<Effect>               = new WeakRef(this);
	private _callback:     () => void;
	private _dependencies: Map<Signal<unknown>, unknown> = new Map();
	private _disposed:     boolean                       = false;
	private _scheduled:    boolean                       = false;

	constructor(callback: () => void) {
		this._callback = callback;
	}

	_mark_for_update() {
		if (this._disposed || this._scheduled) {
			return;
		}

		if (processing.batch_effects === null) {
			throw new Error('Invalid batch pending state');
		}

		this._scheduled = true;

		processing.batch_effects.add(() => this._run());
	}

	_add_dependency(signal: Signal<unknown>, value: unknown) {
		this._dependencies.set(signal, value);
		(signal as any)._dependents.add(this._ref);
	}

	private _remove_dependencies() {
		this._dependencies.forEach((_v, parent) => {
			(parent as any)._dependents.delete(this._ref);
		});

		this._dependencies.clear();
	}

	_run() {
		if (this._disposed) {
			return;
		}

		this._scheduled = false;

		if (this._dependencies.size > 0) {
			let changed = false;

			for (const [dep, oldValue] of this._dependencies) {
				try {
					if (dep.peek() !== oldValue) {
						changed = true;
						break;
					}
				} catch {
					changed = true;
					break;
				}
			}

			if (!changed) {
				return;
			}
		}

		this._remove_dependencies();

		const old           = processing.computed;
		processing.computed = this as any;

		try {
			this._callback();
		} finally {
			processing.computed = old;
		}
	}

	dispose() {
		this._disposed = true;
		this._remove_dependencies();
	}
}

export function signal<T>(value: T): Signal<T> {
	return new Signal(value);
}

export function computed<T>(f: () => T): ReadonlySignal<T> {
	return new Computed(f);
}

export function effect(callback: () => void): () => void {
	const e = new Effect(callback);

	batch(() => {
		e._run();
	});

	return () => e.dispose();
}

export function batch<T>(callback: () => T): T {
	if (processing.batch_effects === null) {
		const effects: Set<() => void> = new Set();

		processing.batch_effects = effects;

		try {
			return callback();
		} finally {
			processing.batch_effects = null;

			processing.signals.clear();

			effects.forEach(effect => {
				effect();
			});
		}
	} else {
		return callback();
	}
}
