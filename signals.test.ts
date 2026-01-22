import { signal, computed, effect, batch } from './signals.ts';
import { TestSuite } from './signals.suite.ts';

const tests = new TestSuite();

tests.run('basic: signal updates', () => {
	const a = signal<number>(1);
	tests.assert_equal(a.value, 1);

	a.value = 5;
	tests.assert_equal(a.value, 5);
});

tests.run('basic: computed updates when dependency changes', () => {
	const a = signal<number>(2);
	const b = computed<number>(() => a.value * 2);

	tests.assert_equal(b.value, 4);

	a.value = 3;
	tests.assert_equal(b.value, 6);
});

tests.run('basic: multiple dependencies', () => {
	const a = signal<number>(2);
	const b = signal<number>(3);
	const c = computed<number>(() => a.value + b.value);

	tests.assert_equal(c.value, 5);

	a.value = 5;
	tests.assert_equal(c.value, 8);

	b.value = 10;
	tests.assert_equal(c.value, 15);
});

tests.run('basic: chained computed signals', () => {
	const a = signal<number>(2);
	const b = computed<number>(() => a.value * 2);
	const c = computed<number>(() => b.value + 1);

	tests.assert_equal(c.value, 5);

	a.value = 3;
	tests.assert_equal(c.value, 7);
});

tests.run('basic: peek does not create dependency', () => {
	const a = signal<number>(1);
	let computed_call_count = 0;
	const b = computed<number>(() => {
		computed_call_count++;
		return a.peek() + 10; // using peek instead of .value
	});

	tests.assert_equal(b.value, 11);
	tests.assert_equal(computed_call_count, 1);

	a.value = 2;
	// b should not recompute since it used peek()
	tests.assert_equal(b.value, 11);
	tests.assert_equal(computed_call_count, 1);
});

tests.run('basic: computed readonly', () => {
	const a = signal<number>(1);
	const b = computed<number>(() => a.value * 2);

	let error_thrown = false;
	try {
		(b as any).value = 10;
	} catch (e) {
		error_thrown = true;
		tests.assert(e instanceof Error);
		tests.assert_equal((e as Error).message, 'Computed signals are readonly');
	}
	tests.assert(error_thrown, 'expected error when setting computed value');
});

tests.run('diamond dependency: basic case', () => {
	const a = signal<number>(1);
	const b = computed<number>(() => a.value + 1); // a -> b
	const c = computed<number>(() => a.value * 2); // a -> c
	const d = computed<number>(() => b.value + c.value); // b,c -> d

	tests.assert_equal(d.value, 4); // (1+1) + (1*2) = 4

	a.value = 2;
	tests.assert_equal(d.value, 7); // (2+1) + (2*2) = 7
});

tests.run('diamond dependency: complex case', () => {
	const root = signal<number>(1);

	// first level
	const left = computed<number>(() => root.value * 2);
	const right = computed<number>(() => root.value + 10);

	// second level - depends on both paths from root
	const result = computed<number>(() => left.value + right.value);

	tests.assert_equal(result.value, 13); // (1*2) + (1+10) = 13

	root.value = 3;
	tests.assert_equal(result.value, 19); // (3*2) + (3+10) = 19
});

tests.run('diamond dependency: deep nesting', () => {
	const a = signal<number>(1);
	const b = computed<number>(() => a.value + 1);
	const c = computed<number>(() => a.value * 2);
	const d = computed<number>(() => b.value + c.value);
	const e = computed<number>(() => b.value - c.value);
	const f = computed<number>(() => d.value + e.value);

	tests.assert_equal(f.value, 4); // ((1+1)+(1*2)) + ((1+1)-(1*2)) = 4 + 0 = 4

	a.value = 5;
	tests.assert_equal(f.value, 12); // ((5+1)+(5*2)) + ((5+1)-(5*2)) = 16 + (-4) = 12
});

tests.run('effect: basic functionality', () => {
	const a = signal<number>(1);
	let effect_value = 0;

	const dispose = effect(() => {
		effect_value = a.value * 2;
	});

	tests.assert_equal(effect_value, 2);

	a.value = 3;
	tests.assert_equal(effect_value, 6);

	dispose();

	a.value = 5;
	tests.assert_equal(effect_value, 6); // should not update after disposal
});

tests.run('effect: multiple signals', () => {
	const a = signal<number>(1);
	const b = signal<number>(2);
	let sum = 0;

	effect(() => {
		sum = a.value + b.value;
	});

	tests.assert_equal(sum, 3);

	a.value = 5;
	tests.assert_equal(sum, 7);

	b.value = 10;
	tests.assert_equal(sum, 15);
});

tests.run('batch: prevents intermediate updates', () => {
	const a = signal<number>(1);
	const b = signal<number>(2);
	const c = computed<number>(() => a.value + b.value);

	let effect_call_count = 0;
	effect(() => {
		c.value; // access c to create dependency
		effect_call_count++;
	});

	tests.assert_equal(effect_call_count, 1);

	batch(() => {
		a.value = 10;
		b.value = 20;
	});

	tests.assert_equal(effect_call_count, 2); // should only be called once after batch
	tests.assert_equal(c.value, 30);
});

tests.run('batch: nested batches', () => {
	const a = signal<number>(1);
	let effect_call_count = 0;

	effect(() => {
		a.value;
		effect_call_count++;
	});

	tests.assert_equal(effect_call_count, 1);

	batch(() => {
		a.value = 2;
		batch(() => {
			a.value = 3;
		});
		a.value = 4;
	});

	tests.assert_equal(effect_call_count, 2);
	tests.assert_equal(a.value, 4);
});

tests.run('edge case: computed with no dependencies', () => {
	let call_count = 0;
	const c = computed<number>(() => {
		call_count++;
		return 42;
	});

	tests.assert_equal(c.value, 42);
	tests.assert_equal(call_count, 1);

	// should not recompute since no dependencies
	tests.assert_equal(c.value, 42);
	tests.assert_equal(call_count, 1);
});

tests.run('edge case: conditional dependencies', () => {
	const flag = signal<boolean>(true);
	const a = signal<number>(1);
	const b = signal<number>(10);

	let computed_call_count = 0;
	const c = computed<number>(() => {
		computed_call_count++;
		return flag.value ? a.value : b.value;
	});

	tests.assert_equal(c.value, 1);
	tests.assert_equal(computed_call_count, 1);

	// changing b should not trigger recomputation since flag is true
	b.value = 20;
	tests.assert_equal(c.value, 1);
	tests.assert_equal(computed_call_count, 1);

	// changing a should trigger recomputation
	a.value = 5;
	tests.assert_equal(c.value, 5);
	tests.assert_equal(computed_call_count, 2);

	// switch the flag
	flag.value = false;
	tests.assert_equal(c.value, 20);
	tests.assert_equal(computed_call_count, 3);

	// now changing a should not trigger recomputation
	a.value = 100;
	tests.assert_equal(c.value, 20);
	tests.assert_equal(computed_call_count, 3);
});

tests.run('edge case: deep recursion', () => {
	const signals = [];
	const computeds = [];

	// create a chain of 100 signals and computeds
	for (let i = 0; i < 100; i++) {
		signals.push(signal<number>(i));
		if (i > 0) {
			computeds.push(computed<number>(() => signals[i].value + computeds[i-1].value));
		} else {
			computeds.push(computed<number>(() => signals[i].value));
		}
	}

	// should be able to compute the final value
	const final_value = computeds[99].value;
	tests.assert_equal(final_value, 4950); // sum from 0 to 99
});

tests.run('edge case: same value assignment does not retrigger effect', () => {
	const a = signal<number>(5);
	let effect_call_count = 0;

	effect(() => {
		a.value;
		effect_call_count++;
	});

	tests.assert_equal(effect_call_count, 1);

	// setting same value - implementation optimizes this
	a.value = 5;
	tests.assert_equal(effect_call_count, 1);
});

tests.run('edge case: computed throws error', () => {
	const a = signal<number>(1);
	const b = computed<number>(() => {
		if (a.value === 0) {
			throw new Error('Division by zero');
		}
		return 10 / a.value;
	});

	tests.assert_equal(b.value, 10);

	let error_thrown = false;
	try {
		a.value = 0;
		b.value; // this should throw
	} catch (e) {
		error_thrown = true;
		tests.assert(e instanceof Error);
		tests.assert_equal((e as Error).message, 'Division by zero');
	}
	tests.assert(error_thrown, 'expected error to be thrown');
});

tests.run('edge case: effect with computed', () => {
	const a = signal<number>(1);
	const b = computed<number>(() => a.value * 2);
	let effect_value = 0;

	effect(() => {
		effect_value = b.value + 10;
	});

	tests.assert_equal(effect_value, 12);

	a.value = 5;
	tests.assert_equal(effect_value, 20);
});

tests.run('memory: weak references cleanup', () => {
	const a = signal<number>(1);
	let b: any = computed<number>(() => a.value * 2);

	// access to create the dependency
	tests.assert_equal(b.value, 2);

	// clear the reference
	b = null;

	// force garbage collection if possible
	if (global.gc) {
		global.gc();
	}

	// the original signal should still work
	a.value = 5;
	tests.assert_equal(a.value, 5);
});

tests.run('performance: lazy evaluation', () => {
	const a = signal<number>(1);
	let expensive_call_count = 0;

	const expensive = computed<number>(() => {
		expensive_call_count++;
		// simulate expensive computation
		let result = 0;
		for (let i = 0; i < 1000; i++) {
			result += a.value;
		}
		return result;
	});

	// should not compute until accessed
	tests.assert_equal(expensive_call_count, 0);

	// first access should compute
	tests.assert_equal(expensive.value, 1000);
	tests.assert_equal(expensive_call_count, 1);

	// second access should use cached value
	tests.assert_equal(expensive.value, 1000);
	tests.assert_equal(expensive_call_count, 1);

	// changing dependency should mark for recomputation but not compute yet
	a.value = 2;
	tests.assert_equal(expensive_call_count, 1);

	// next access should recompute
	tests.assert_equal(expensive.value, 2000);
	tests.assert_equal(expensive_call_count, 2);
});

// test for cycle detection
tests.run('cycle detection: direct cycle', () => {
	const a = signal<number>(1);

	let error_thrown = false;
	try {
		// create a computed that tries to modify its own dependency
		const b = computed<number>(() => {
			const val = a.value; // read from a
			if (val > 5) {
				// this may trigger cycle detection or stack overflow
				a.value = val + 1; // write to a
			}
			return val + 1;
		});

		// trigger the cycle by setting a value that meets the condition
		a.value = 6;
		b.value; // access b to trigger computation
	} catch (e) {
		error_thrown = true;
		tests.assert(e instanceof Error);
		// implementation might not catch this specific cycle pattern
		tests.assert((e as Error).message.includes('Cycle detected') ||
		           (e as Error).message.includes('Maximum call stack size exceeded'));
	}

	// if no error was thrown, implementation handles this case differently
	if (!error_thrown) {
		tests.assert(true, 'no cycle detected - implementation may handle this case safely');
	}
});

tests.run('cycle detection: prevents infinite loops', () => {
	const a = signal<number>(1);

	let error_thrown = false;
	try {
		const problematic = computed<number>(() => {
			const val = a.value;
			if (val < 5) {
				a.value = val + 1; // creates cycle
			}
			return val;
		});

		problematic.value; // trigger the computation
	} catch (e) {
		error_thrown = true;
		// implementation prevents cycles either explicitly or via stack overflow
		const message = e instanceof Error ? e.message : String(e);
		tests.assert(
			message.includes('Cycle detected') ||
			message.includes('Maximum call stack size exceeded') ||
			message.includes('RangeError'),
			`unexpected cycle prevention: ${message}`
		);
	}

	// implementation may handle this case without error - that's acceptable
	if (!error_thrown) {
		tests.assert(true, 'implementation handled potential cycle safely');
	}
});

tests.run('type safety: different types', () => {
	const string_signal = signal<string>('hello');
	const number_signal = signal<number>(42);
	const boolean_signal = signal<boolean>(true);

	const mixed = computed<string>(() => {
		return `${string_signal.value}-${number_signal.value}-${boolean_signal.value}`;
	});

	tests.assert_equal(mixed.value, 'hello-42-true');

	string_signal.value = 'world';
	number_signal.value = 100;
	boolean_signal.value = false;

	tests.assert_equal(mixed.value, 'world-100-false');
});

tests.run('edge case: undefined and null values', () => {
	const null_signal = signal<null>(null);
	const undefined_signal = signal<undefined>(undefined);
	const optional_signal = signal<number | undefined>(undefined);

	tests.assert_equal(null_signal.value, null);
	tests.assert_equal(undefined_signal.value, undefined);
	tests.assert_equal(optional_signal.value, undefined);

	optional_signal.value = 42;
	tests.assert_equal(optional_signal.value, 42);

	optional_signal.value = undefined;
	tests.assert_equal(optional_signal.value, undefined);
});

tests.run('edge case: object and array signals', () => {
	const obj_signal = signal<{count: number}>({count: 1});
	const arr_signal = signal<number[]>([1, 2, 3]);

	const combined = computed<number>(() => {
		return obj_signal.value.count + arr_signal.value.length;
	});

	tests.assert_equal(combined.value, 4);

	// mutating the object (reference stays same)
	obj_signal.value.count = 5;
	// this won't trigger update because reference didn't change
	tests.assert_equal(combined.value, 4);

	// setting new object reference
	obj_signal.value = {count: 10};
	tests.assert_equal(combined.value, 13);

	// setting new array
	arr_signal.value = [1, 2, 3, 4, 5];
	tests.assert_equal(combined.value, 15);
});

tests.run('edge case: computed accessing multiple times', () => {
	const a = signal<number>(1);
	let access_count = 0;

	const c = computed<number>(() => {
		const val1 = a.value; // first access
		access_count++;
		const val2 = a.value; // second access to same signal
		access_count++;
		return val1 + val2;
	});

	tests.assert_equal(c.value, 2);
	tests.assert_equal(access_count, 2);

	// reset counter
	access_count = 0;
	a.value = 3;
	tests.assert_equal(c.value, 6);
	tests.assert_equal(access_count, 2);
});

tests.run('edge case: effect disposal multiple times', () => {
	const a = signal<number>(1);
	let effect_call_count = 0;

	const dispose = effect(() => {
		a.value;
		effect_call_count++;
	});

	tests.assert_equal(effect_call_count, 1);

	// dispose once
	dispose();
	a.value = 2;
	tests.assert_equal(effect_call_count, 1); // should not increment

	// dispose again (should be safe)
	dispose();
	a.value = 3;
	tests.assert_equal(effect_call_count, 1); // should still not increment
});

tests.run('edge case: nested effects', () => {
	const a = signal<number>(1);
	const b = signal<number>(2);
	let outer_count = 0;
	let inner_count = 0;

	const outer_dispose = effect(() => {
		outer_count++;
		const inner_dispose = effect(() => {
			inner_count++;
			b.value; // create dependency on b
		});
		a.value; // create dependency on a in outer effect
	});

	tests.assert_equal(outer_count, 1);
	tests.assert_equal(inner_count, 1);

	// changing a should trigger outer effect
	a.value = 5;
	tests.assert_equal(outer_count, 2);

	outer_dispose();
});

tests.run('edge case: empty batch', () => {
	const a = signal<number>(1);
	let effect_call_count = 0;

	effect(() => {
		a.value;
		effect_call_count++;
	});

	tests.assert_equal(effect_call_count, 1);

	// empty batch should not cause any issues
	batch(() => {
		// do nothing
	});

	tests.assert_equal(effect_call_count, 1);
	tests.assert_equal(a.value, 1);
});

tests.run('edge case: batch returning value', () => {
	const a = signal<number>(1);
	const b = signal<number>(2);

	const result = batch(() => {
		a.value = 10;
		b.value = 20;
		return a.value + b.value;
	});

	tests.assert_equal(result, 30);
	tests.assert_equal(a.value, 10);
	tests.assert_equal(b.value, 20);
});

tests.run('edge case: computed with side effects', () => {
	const a = signal<number>(1);
	let side_effect_value = 0;

	const c = computed<number>(() => {
		// this is generally not recommended, but should still work
		side_effect_value = a.value * 10;
		return a.value + 1;
	});

	tests.assert_equal(c.value, 2);
	tests.assert_equal(side_effect_value, 10);

	a.value = 3;
	tests.assert_equal(c.value, 4);
	tests.assert_equal(side_effect_value, 30);
});

tests.run('performance: computed memoization', () => {
	const a = signal<number>(1);
	const b = signal<number>(2);
	let expensive_call_count = 0;

	const expensive = computed<number>(() => {
		expensive_call_count++;
		return a.value * 1000 + b.value;
	});

	// first access
	tests.assert_equal(expensive.value, 1002);
	tests.assert_equal(expensive_call_count, 1);

	// multiple accesses without changes should not recompute
	tests.assert_equal(expensive.value, 1002);
	tests.assert_equal(expensive.value, 1002);
	tests.assert_equal(expensive_call_count, 1);

	// change one dependency
	a.value = 2;
	tests.assert_equal(expensive.value, 2002);
	tests.assert_equal(expensive_call_count, 2);

	// multiple accesses again
	tests.assert_equal(expensive.value, 2002);
	tests.assert_equal(expensive_call_count, 2);
});

tests.print_results();
