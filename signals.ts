// sfl-signals
// 0.1.0
//
// dependency-free signals implementation that uses weakref for handling garbage
// collected references. all operations are internally batched to prevent cascading
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
	computed: null as Computed<unknown> | null, // currently executing computed or effect
	effects:  null as Set<() => void> | null,   // effects to run after batch
}

export class Signal<T> {
	protected current_value: T;
	protected dependents:    Set<WeakRef<Signal<unknown>>> = new Set();

	constructor(value: T) {
		this.current_value = value;
	}

	protected mark_for_update() {
		this.dependents.forEach(dependent_ref => {
			const dependent = dependent_ref.deref();

			if (dependent) {
				dependent.mark_for_update();
			} else {
				this.dependents.delete(dependent_ref);
			}
		});
	}

	public peek(): T {
		return this.current_value;
	}

	public get value(): T {
		const value = this.current_value;

		if (processing.computed !== null) {
			processing.computed.add_dependency(this, value);
		}

		return value;
	}

	public set value(value: T) {
		if (processing.computed !== null && !(processing.computed as any)._is_effect) {
			throw new Error('Cycle detected');
		}

		if (value === this.current_value) {
			return;
		}

		this.current_value = value;

		batch(() => {
			this.mark_for_update();
		});
	}
}

export class Computed<T> extends Signal<T> implements ReadonlySignal<T> {
	protected ref:          WeakRef<this>                 = new WeakRef(this);
	protected first:        boolean                       = true;
	protected must_update:  boolean                       = true;
	protected error:        unknown                       = undefined; // cached thrown value
	protected has_error:    boolean                       = false;     // whether error is valid
	protected dependencies: Map<Signal<unknown>, unknown> = new Map();
	protected callback:     () => T;

	constructor(callback: () => T) {
		super(undefined as unknown as T);
		this.callback = callback;
	}

	protected mark_for_update() {
		this.must_update = true;
		super.mark_for_update();
	}

	public add_dependency(accessed_signal: Signal<unknown>, value: unknown) {
		this.dependencies.set(accessed_signal, value);
		(accessed_signal as any).dependents.add(this.ref);
	}

	protected remove_dependencies() {
		this.dependencies.forEach((_value, parent) => {
			(parent as any).dependents.delete(this.ref);
		});

		this.dependencies.clear();
	}

	public peek(): T {
		if (this.must_update) {
			this.must_update = false;

			let changed = false;

			if (this.first) {
				this.first = false;
				changed = true;
			} else {
				for (const [parent, oldValue] of this.dependencies) {
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
				this.remove_dependencies();

				const old = processing.computed;
				processing.computed = this;

				try {
					this.current_value = this.callback();
					this.has_error = false;
				} catch (e) {
					this.error = e;
					this.has_error = true;
				} finally {
					processing.computed = old;
				}
			}
		}

		if (this.has_error) {
			throw this.error;
		}

		return this.current_value;
	}

	public get value(): T {
		const value = this.peek();

		if (processing.computed !== null) {
			processing.computed.add_dependency(this, value);
		}

		return value;
	}

	public set value(_: T) {
		throw new Error('Computed signals are readonly');
	}
}

class Effect {
	private ref:          WeakRef<Effect>               = new WeakRef(this);
	private callback:     () => void;
	private dependencies: Map<Signal<unknown>, unknown> = new Map();
	private disposed:     boolean                       = false;
	private scheduled:    boolean                       = false;
	readonly _is_effect:  true                          = true;

	constructor(callback: () => void) {
		this.callback = callback;
	}

	public mark_for_update() {
		if (this.disposed || this.scheduled) {
			return;
		}

		if (processing.effects === null) {
			throw new Error('Invalid batch pending state');
		}

		this.scheduled = true;

		processing.effects.add(() => this.run());
	}

	public add_dependency(signal: Signal<unknown>, value: unknown) {
		this.dependencies.set(signal, value);
		(signal as any).dependents.add(this.ref);
	}

	private remove_dependencies() {
		this.dependencies.forEach((_v, parent) => {
			(parent as any).dependents.delete(this.ref);
		});

		this.dependencies.clear();
	}

	public run() {
		if (this.disposed) {
			return;
		}

		this.scheduled = false;

		if (this.dependencies.size > 0) {
			let changed = false;

			for (const [dep, oldValue] of this.dependencies) {
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

		this.remove_dependencies();

		const old = processing.computed;
		processing.computed = this as any;

		try {
			this.callback();
		} finally {
			processing.computed = old;
		}
	}

	public dispose() {
		this.disposed = true;
		this.remove_dependencies();
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
		e.run();
	});

	return () => e.dispose();
}

export function batch<T>(callback: () => T): T {
	if (processing.effects === null) {
		const effects: Set<() => void> = new Set();

		processing.effects = effects;

		try {
			return callback();
		} finally {
			processing.effects = null;

			effects.forEach(effect => {
				effect();
			});
		}
	} else {
		return callback();
	}
}

// extend a custom element by mapping all non-global attributes to DOM properties
// of the instance, where the value is wrapped as a signal. attributes are kept in
// sync with the signal value as strings
export class SignalElement extends HTMLElement {
	// add an internal check for the first time the component is
	// inserted in the DOM. this allows for static definition of attributes
	// that only get converted to signals when inserted the first time.
	// the fact that this does not re-run on subsequent connectedCallback
	// calls (when a DOM item is moved, reordered, etc.) also keeps the
	// initialized instance and its signals in memory
	//
	//     e.g.
	//
	//     class MySignalElement extends SignalElement {
	//         declare custom: string;  // declare beforehand for correct typechecking
	//     }
	//
	//     const element = document.createElement('custom-element');
	//     element.setAttribute('custom', 'value');
	//
	//     body.appendChild(element);   // element is now initialized
	//
	//     element                      // MySignalElement
	//     element.custom.value         // Signal<string>;
	initialized = false;

	constructor() {
		super();
	}

	connectedCallback() {
		if (!this.initialized) {
			// iterate through all defined html attributes (except for global attributes) and define
			// them as DOM properties with signals as values. the initial string value taken from the html
			// attribute is cast as a literal value. any subsequent assignments to the signal value will
			// set the value of the corresponding html attribute. this is useful for simple two-way data
			// binding of booleans, numbers, etc. though not for objects, as setAttribute() always converts
			// the value back to string format.
			//
			//     e.g.
			//
			//     <my-custom-element foo-bar="baz">
			//
			//     class MySignalElement extends SignalElement {
			//        init() {
			//           this.foo_bar.value;          // -> 'baz'
			//           this.foo_bar.value = 'qux'   // -> <my-custom-element foo-bar="qux">
			//        }
			//     }
			const global_attributes = [
				'accesskey',
				'class',
				'contenteditable',
				'dir',
				'draggable',
				'enterkeyhint',
				'hidden',
				'id',
				'inert',
				'inputmode',
				'lang',
				'popover',
				'role',
				'spellcheck',
				'style',
				'tabindex',
				'title',
				'translate',
			];

			for (const attribute_name of this.getAttributeNames()) {
				const attribute_property_name = attribute_name.replace(/-/g, '_'); // hypen-case to snake_case
				const attribute_initial_value = this.getAttribute(attribute_name)!;
				const is_attribute_global = global_attributes
					.map(
						attr =>
							attribute_name === attr ||
							attribute_name.startsWith('data-') ||
							attribute_name.startsWith('aria-')
					)
					.some(attr => attr === true);

				if (!is_attribute_global) {
					(this as any)[attribute_property_name] = new SignalElementAttributeSignal(
						attribute_initial_value,
						attribute_name,
						this
					);
				}
			}

			this.init();
		}

		this.initialized = true;
	}

	init() {}
}

// use a class to wrap the signal value of a custom attribute, and cast the initial attribute
// (string) value to a number/boolean/null if necessary. getting property.value accesses the internal
// signal.value, and setting a property.value assigns signal.value and sets the corresponding
// HTML attribute value as string
class SignalElementAttributeSignal {
	declare current_value:  Signal<unknown>;
	declare name:           string;
	declare element:        SignalElement;

	constructor(
		attribute_initial_value: string,
		attribute_name:          string,
		element:                 SignalElement
	) {
		this.current_value = signal(this.cast_attribute_value(attribute_initial_value));
		this.name          = attribute_name;
		this.element       = element;
	}

	cast_attribute_value(initial_value: string) {
		switch (initial_value) {
			case '':
			case 'null':
			case 'undefined':
				return null;
			case 'true':
				return true;
			case 'false':
				return false;
			default:
				const n = +initial_value; // +value is the fastest numeric coercion
				return Number.isNaN(n) ? initial_value : n;
		}
	}

	get value() {
		return this.current_value.value;
	}

	set value(new_value: unknown) {
		this.current_value.value = new_value;
		this.element.setAttribute(this.name, String(new_value));
	}
}
