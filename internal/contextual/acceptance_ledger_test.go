package contextual

import (
	"encoding/json"
	"errors"
	"math/big"
	"os"
	"path/filepath"
	"syscall"
)

// Every claim is itself a permanent reservation. No mutable/refundable total:
// an interrupted write poisons admission rather than recovering headroom.
func claimAcceptance(root string, g acceptanceGrant) error {
	if !filepath.IsAbs(root) {
		return errors.New("ledger_directory") // no canonical OS-account ledger
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return errors.New("ledger_directory")
	}
	lockPath := filepath.Join(root, "lock")
	lock, err := acceptanceOpenPrivate(lockPath, true)
	if err != nil {
		lock, err = acceptanceOpenPrivate(lockPath, false)
	}
	if err != nil {
		return errors.New("ledger_lock")
	}
	defer lock.Close()
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		return errors.New("ledger_busy")
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	entries, err := os.ReadDir(root)
	if err != nil {
		return errors.New("ledger_read")
	}
	total := new(big.Rat)
	for _, e := range entries {
		if e.Name() == "lock" {
			continue
		}
		data, err := acceptanceReadPrivate(filepath.Join(root, e.Name()), 16384)
		if err != nil {
			return errors.New("ledger_corrupt")
		}
		var prior struct{ ID, Amount string }
		if json.Unmarshal(data, &prior) != nil || prior.ID+".json" != e.Name() || !acceptanceCanonicalMoney(prior.Amount) {
			return errors.New("ledger_corrupt")
		}
		if prior.ID == g.ID {
			return errors.New("grant_used")
		}
		amount, _ := new(big.Rat).SetString(prior.Amount)
		total.Add(total, amount)
	}
	amount, ok := new(big.Rat).SetString(g.Config.Limits.Amount)
	if !ok || amount.Sign() <= 0 {
		return errors.New("ledger_amount")
	}
	total.Add(total, amount)
	if total.Cmp(big.NewRat(5, 1)) >= 0 {
		return errors.New("aggregate_exhausted")
	}
	data, _ := json.Marshal(struct{ ID, Amount string }{g.ID, g.Config.Limits.Amount})
	if acceptanceWritePrivate(filepath.Join(root, g.ID+".json"), data) != nil {
		return errors.New("grant_claim")
	}
	return nil
}
