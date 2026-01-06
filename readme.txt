sfl-signals

dependency-free signals implementation that uses weakref for handling garbage
collected referenced. all operations are internally batched to prevent cascading
updates during (synchronous) mutations.

USAGE
    import { signal, computed, effect, batch } from './signals';

    // basic signal
    const count = signal(0);
    count.value = 5;
    console.log(count.value); // 5

    // computed values
    const doubled = computed(() => count.value * 2);
    console.log(doubled.value); // 10

    // side effects
    const dispose = effect(() => {
        console.log(`count is ${count.value}`);
    });

    // batched updates
    batch(() => {
        count.value = 10;
        count.value = 20; // only one effect execution
    });

    // cleanup
    dispose();
