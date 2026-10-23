// Package daily is the daily proof game's domain: feedback, hints, stats and the attempt rules
// (SPEC §8). The pure functions here are tested without HTTP or a database; Service applies
// them in database transactions.
package daily

// Feedback letters (SPEC §8.3).
const (
	Green  = 'G' // the right move at the right ply
	Yellow = 'Y' // a solution move at another ply of the same colour
	Gray   = 'X'
)

// Feedback compares a guess with the solution ply by ply (SPEC §8.3). Greens are assigned
// first; then, left to right, a guess move that equals a not-yet-used solution move at another
// ply of the same colour is yellow (the leftmost such ply is used up); everything else is gray.
// Both slices have the puzzle's length.
func Feedback(solution, guess []string) string {
	out := make([]byte, len(guess))
	used := make([]bool, len(solution))
	for i, g := range guess {
		out[i] = Gray
		if i < len(solution) && g == solution[i] {
			out[i] = Green
			used[i] = true
		}
	}
	for i, g := range guess {
		if out[i] == Green {
			continue
		}
		for j := i % 2; j < len(solution); j += 2 {
			if j != i && !used[j] && solution[j] == g {
				out[i] = Yellow
				used[j] = true
				break
			}
		}
	}
	return string(out)
}
