export class TestSuite {
	public passed: number = 0;
	public failed: number = 0;
	public total:  number = 0;
	public tests: {
		name:   string;
		passed: boolean;
		error?: string;
	}[] = [];

	assert(condition: boolean, message: string = 'Assertion failed'): void {
		if (!condition) {
			throw new Error(message);
		}
	}

	assert_equal<T>(actual: T, expected: T, message?: string): void {
		if (actual !== expected) {
			const msg = message || `Expected ${expected}, got ${actual}`;
			throw new Error(msg);
		}
	}

	assert_null(value: any, message?: string): void {
		if (value !== null) {
			const msg = message || `Expected null, got ${value}`;
			throw new Error(msg);
		}
	}

	assert_not_null(value: any, message?: string): void {
		if (value === null || value === undefined) {
			const msg = message || `Expected non-null value, got ${value}`;
			throw new Error(msg);
		}
	}

	assert_object_equal(actual: Record<string, any>, expected: Record<string, any>, message?: string): void {
		const actual_keys = Object.keys(actual).sort();
		const expected_keys = Object.keys(expected).sort();

		if (actual_keys.length !== expected_keys.length) {
			const msg = message || `object keys length mismatch: expected ${expected_keys.length}, got ${actual_keys.length}`;
			throw new Error(msg);
		}

		for (let i = 0; i < actual_keys.length; i++) {
			if (actual_keys[i] !== expected_keys[i]) {
				const msg = message || `object key mismatch: expected ${expected_keys[i]}, got ${actual_keys[i]}`;
				throw new Error(msg);
			}
		}

		for (const key of actual_keys) {
			if (actual[key] !== expected[key]) {
				const msg = message || `object value mismatch for key '${key}': expected ${expected[key]}, got ${actual[key]}`;
				throw new Error(msg);
			}
		}
	}

	run(test_name: string, test_fn: () => void): void {
		try {
			test_fn();
			this.tests.push({ name: test_name, passed: true });
			this.passed += 1;
		} catch (error) {
			this.tests.push({
				name: test_name,
				passed: false,
				error: error instanceof Error ? error.message : String(error),
			});

			this.failed += 1;
		}

		this.total += 1;
	}

	print_results(): void {
		this.tests.forEach(test => {
			const status = test.passed ? '[PASS]' : '[FAIL]';

			console.log(`${status} ${test.name}`);

			if (!test.passed && test.error) {
				console.log(`   ${test.error}`);
			}
		});

		console.log('---');
		console.log('TOTAL: %d', this.total);
		console.log('PASS:  %d', this.passed);
		console.log('FAIL:  %d', this.failed);
	}
}
