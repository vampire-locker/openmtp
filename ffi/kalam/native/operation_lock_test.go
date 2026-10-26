package main

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestConcurrentDeviceOperations(t *testing.T) {
	var active int32
	var overlap int32
	var completed int32
	var workers sync.WaitGroup
	for i := 0; i < 32; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			lockMtp()
			defer unlockMtp()
			if atomic.AddInt32(&active, 1) != 1 {
				atomic.StoreInt32(&overlap, 1)
			}
			time.Sleep(time.Millisecond)
			atomic.AddInt32(&active, -1)
			atomic.AddInt32(&completed, 1)
		}()
	}
	workers.Wait()
	if overlap != 0 || completed != 32 {
		t.Fatalf("concurrent USB access: overlap=%d completed=%d", overlap, completed)
	}
}
