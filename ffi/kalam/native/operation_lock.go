package main

import "sync"

// One device/session has one transaction sequence. The old bool was released
// inside lockMtp, before the exported operation actually used the USB session.
// Keep the gate for the entire exported call, including callbacks. Queued calls
// wait instead of spuriously failing when JS chains the next operation.
var mtpOperation sync.Mutex

func lockMtp()   { mtpOperation.Lock() }
func unlockMtp() { mtpOperation.Unlock() }
