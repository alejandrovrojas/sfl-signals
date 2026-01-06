// sfl-signals
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
	signals:        new Set<Signal<unknown>>(),       // signals accessed during current batch
	computed:       null as Computed<unknown> | null, // currently executing computed
	batch_effects:  null as Set<() => void> | null,   // effects to run after batch
}

export class Signal<T> {
	protected _value: T;
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
				// delete garbage collected references
				this._dependents.delete(dependent_ref);
			}
		});
	}

	public peek(): T {
		return this._value;
	}

	public get value(): T {
		const value = this._value;

		// inside a computed
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

		this._value = value;

		// prevents cascading effects
		batch(() => {
			this._mark_for_update();
		});
	}
}

export class Computed<T> extends Signal<T> implements ReadonlySignal<T> {
	protected _ref:          WeakRef<this>                  = new WeakRef(this); // reused weakref for consistent identity
	protected _first:        boolean                        = true;              // first execution flag
	protected _must_update:  boolean                        = true;              // dirty flag from dependencies
	protected _dependencies: Map<Signal<unknown>, unknown>  = new Map();         // tracked dependencies and their last values
	protected _callback:     ()                             => T;

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

			try {
				let changed = false;

				if (this._first) {
					this._first = false;
					changed = true;
				} else {
					this._dependencies.forEach((oldValue, parent) => {
						const newValue = parent.peek();

						if (oldValue !== newValue) {
							changed = true;
						}
					});
				}

				if (changed) {
					this._remove_dependencies();

					const old = processing.computed;
					processing.computed = this;

					try {
						this._value = this._callback();
					} finally {
						processing.computed = old;
					}
				}
			} catch (e) {
				throw e;
			}
		}

		return this._value;
	}

	public get value(): T {
		const value = this.peek();

		// inside another computed
		if (processing.computed !== null) {
			processing.computed._add_dependency(this, value);
		}

		return value;
	}

	public set value(v: T) {
		throw new Error('Computed signals are readonly');
	}
}

export class Effect<T> extends Computed<T> implements ReadonlySignal<T> {
	protected _listener: (() => void) | null = null;

	constructor(callback: () => T) {
		super(callback);
	}

	protected _mark_for_update() {
		if (processing.batch_effects === null) {
			throw new Error('Invalid batch pending state');
		}

		if (this._listener !== null) {
			processing.batch_effects!.add(this._listener);
		}

		super._mark_for_update();
	}

	public _listen(callback: (value: T) => void): () => void {
		let old_value = this.value;

		const listener = () => {
			const new_value = this.value;

			if (old_value !== new_value) {
				old_value = new_value;
				callback(old_value);
			}
		};

		this._listener = listener;

		callback(old_value);

		return () => {
			this._listener = null;
			this._remove_dependencies();
		};
	}
}

export function signal<T>(value: T): Signal<T> {
	return new Signal(value);
}

export function computed<T>(f: () => T): ReadonlySignal<T> {
	return new Computed(f);
}

export function effect(callback: () => void): () => void {
	return new Effect(() => batch(callback))._listen(() => {});
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
		// nested batch - just execute inline
		return callback();
	}
}
