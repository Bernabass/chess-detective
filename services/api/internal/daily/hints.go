package daily

import (
	"fmt"
	"strings"

	"github.com/Bernabass/chess-detective/services/api/internal/chessrules"
)

// Hint kinds, served in this order (SPEC §8.4).
const (
	HintMovers   = "movers"
	HintCaptures = "captures"
	HintMove     = "move"
)

// MaxHints is the number of hints a puzzle has.
const MaxHints = 3

// Hint is one hint, with its plain-English text.
type Hint struct {
	Kind  string
	Text  string
	White []string // movers
	Black []string // movers
	Plies []int    // captures, 1-based
	Ply   int      // move, 1-based
	UCI   string   // move
	SAN   string   // move
}

// pieceOrder is the order piece types are listed in.
var pieceOrder = []chessrules.Piece{
	chessrules.King, chessrules.Queen, chessrules.Rook, chessrules.Bishop, chessrules.Knight, chessrules.Pawn,
}

// MoversHint lists which piece types each side moved at least once. Castling moves the rook too.
func MoversHint(solution chessrules.Result) Hint {
	moved := [2]map[chessrules.Piece]bool{{}, {}}
	for _, m := range solution.Moves {
		side := 0
		if !m.White {
			side = 1
		}
		moved[side][m.Piece] = true
		if strings.HasPrefix(m.SAN, "O-O") {
			moved[side][chessrules.Rook] = true
		}
	}
	list := func(side int) []string {
		out := []string{}
		for _, p := range pieceOrder {
			if moved[side][p] {
				out = append(out, string(p))
			}
		}
		return out
	}
	white, black := list(0), list(1)
	describe := func(name string, pieces []string) string {
		if len(pieces) == 0 {
			return name + " didn't move."
		}
		return name + " moved: " + strings.Join(pieces, ", ") + "."
	}
	return Hint{
		Kind:  HintMovers,
		Text:  describe("White", white) + " " + describe("Black", black),
		White: white,
		Black: black,
	}
}

// CapturesHint lists the plies (1-based) where a capture happens.
func CapturesHint(solution chessrules.Result) Hint {
	plies := []int{}
	for i, m := range solution.Moves {
		if m.Capture {
			plies = append(plies, i+1)
		}
	}
	text := "No captures."
	switch len(plies) {
	case 0:
	case 1:
		text = fmt.Sprintf("One capture, on ply %d.", plies[0])
	default:
		parts := make([]string, len(plies))
		for i, p := range plies {
			parts[i] = fmt.Sprint(p)
		}
		text = fmt.Sprintf("%d captures, on plies %s and %s.", len(plies),
			strings.Join(parts[:len(parts)-1], ", "), parts[len(parts)-1])
	}
	return Hint{Kind: HintCaptures, Text: text, Plies: plies}
}

// MovePly is the ply hint 3 reveals: the first ply that isn't green in the latest guess's
// feedback, or ply 1 before any guess (SPEC §8.4). 1-based.
func MovePly(latestFeedback string) int {
	for i, c := range latestFeedback {
		if c != Green {
			return i + 1
		}
	}
	return 1
}

// MoveHint reveals the solution move at ply (1-based).
func MoveHint(solution chessrules.Result, ply int) Hint {
	m := solution.Moves[ply-1]
	side := "White"
	if !m.White {
		side = "Black"
	}
	return Hint{
		Kind: HintMove,
		Text: fmt.Sprintf("Ply %d (%s): %s.", ply, side, m.SAN),
		Ply:  ply,
		UCI:  m.UCI,
		SAN:  m.SAN,
	}
}

// Hints returns the first `used` hints of a puzzle. movePly is the stored ply of hint 3 (0 if
// it hasn't been taken).
func Hints(solution chessrules.Result, used, movePly int) []Hint {
	out := []Hint{}
	if used >= 1 {
		out = append(out, MoversHint(solution))
	}
	if used >= 2 {
		out = append(out, CapturesHint(solution))
	}
	if used >= 3 && movePly >= 1 && movePly <= len(solution.Moves) {
		out = append(out, MoveHint(solution, movePly))
	}
	return out
}
