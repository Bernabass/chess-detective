package daily

import "time"

// MaxGuesses is the number of guesses per attempt.
const MaxGuesses = 6

// FinishedAttempt is what stats are computed from: a finished, non-archive attempt.
type FinishedAttempt struct {
	Day     time.Time // the puzzle's day (a solve counts for it, even after midnight)
	Solved  bool
	Guesses int
	Hints   int
}

// Stats are a player's daily-puzzle statistics (SPEC §8.5). Archive (practice) attempts don't
// count. CurrentStreak is the run of consecutive solved days ending at LastSolvedDay (0 if a
// later daily was failed); whether it is still current depends on today (see CurrentStreakOn).
type Stats struct {
	Played        int
	Solved        int
	CurrentStreak int
	MaxStreak     int
	LastSolvedDay *time.Time
	GuessDist     [7]int // solves in 1..6 guesses, then failures
	HintsTotal    int
}

// ComputeStats derives a player's stats from their finished daily attempts (any order).
func ComputeStats(attempts []FinishedAttempt) Stats {
	var s Stats
	solvedDays := map[time.Time]bool{}
	for _, a := range attempts {
		s.Played++
		s.HintsTotal += a.Hints
		if a.Solved {
			s.Solved++
			if a.Guesses >= 1 && a.Guesses <= MaxGuesses {
				s.GuessDist[a.Guesses-1]++
			}
			solvedDays[a.Day] = true
		} else {
			s.GuessDist[6]++
		}
	}
	// Runs of consecutive solved days.
	var last time.Time
	for day := range solvedDays {
		if day.After(last) {
			last = day
		}
		if solvedDays[day.AddDate(0, 0, -1)] {
			continue // not the start of a run
		}
		run := 1
		for solvedDays[day.AddDate(0, 0, run)] {
			run++
		}
		s.MaxStreak = max(s.MaxStreak, run)
	}
	if len(solvedDays) > 0 {
		s.LastSolvedDay = &last
		run := 1
		for solvedDays[last.AddDate(0, 0, -run)] {
			run++
		}
		s.CurrentStreak = run
	}
	// A failed daily after the last solve ends the current streak at once (SPEC §8.5).
	for _, a := range attempts {
		if !a.Solved && (s.LastSolvedDay == nil || a.Day.After(*s.LastSolvedDay)) {
			s.CurrentStreak = 0
		}
	}
	return s
}

// CurrentStreakOn is the streak as of today: it only continues while the last solve was today
// or yesterday (today's puzzle may still be ahead).
func CurrentStreakOn(currentStreak int, lastSolvedDay *time.Time, today time.Time) int {
	if lastSolvedDay == nil || lastSolvedDay.Before(today.AddDate(0, 0, -1)) {
		return 0
	}
	return currentStreak
}
