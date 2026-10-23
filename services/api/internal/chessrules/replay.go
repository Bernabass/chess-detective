// Package chessrules replays games for the API with a Go chess library
// (github.com/corentings/chess/v2, MIT). The TypeScript engine is the reference: the
// cross-language vectors in fixtures/replay-vectors.json pin the two together (SPEC §11.2).
package chessrules

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/corentings/chess/v2"
)

// Piece is a piece type.
type Piece string

// Piece types, as used in hint texts.
const (
	Pawn   Piece = "pawn"
	Knight Piece = "knight"
	Bishop Piece = "bishop"
	Rook   Piece = "rook"
	Queen  Piece = "queen"
	King   Piece = "king"
)

// Move describes one move of a replayed game.
type Move struct {
	UCI     string
	SAN     string
	Piece   Piece // the piece that moved (a promoting pawn is a pawn)
	White   bool
	Capture bool // includes en passant
}

// Result is a replayed game: its target key (placement + side to move) and its moves.
type Result struct {
	TargetKey string
	Moves     []Move
}

// IllegalMoveError reports the first move that can't be played.
type IllegalMoveError struct {
	Ply    int // 0-based index of the move
	Move   string
	Reason string
}

func (e *IllegalMoveError) Error() string {
	return fmt.Sprintf("move %d (%q) is not legal: %s", e.Ply+1, e.Move, e.Reason)
}

var uciPattern = regexp.MustCompile(`^[a-h][1-8][a-h][1-8][qrbn]?$`)

// Replay plays UCI moves from the initial position. Draw rules (repetition, the 75-move rule,
// insufficient material) are ignored, like in the engine: a game only stops at an illegal move.
// The UCI rules match the engine's: lowercase, and a promotion letter exactly when a pawn
// reaches the last rank.
func Replay(ucis []string) (Result, error) {
	pos := chess.StartingPosition()
	res := Result{Moves: make([]Move, 0, len(ucis))}
	for ply, uci := range ucis {
		illegal := func(reason string) error {
			return &IllegalMoveError{Ply: ply, Move: uci, Reason: reason}
		}
		if !uciPattern.MatchString(uci) {
			return Result{}, illegal("not a UCI move like e2e4 or e7e8q")
		}
		move := findLegal(pos, uci)
		if move == nil {
			return Result{}, illegal("no legal move matches it")
		}
		piece := pos.Board().Piece(move.S1())
		res.Moves = append(res.Moves, Move{
			UCI:     uci,
			SAN:     chess.AlgebraicNotation{}.Encode(pos, move),
			Piece:   pieceName(piece.Type()),
			White:   piece.Color() == chess.White,
			Capture: move.HasTag(chess.Capture) || move.HasTag(chess.EnPassant),
		})
		pos = pos.Update(move)
	}
	res.TargetKey = targetKey(pos)
	return res, nil
}

// findLegal returns the legal move written as uci, or nil. Comparing against the generated
// legal moves (rather than trusting a parser) means a promotion letter on a non-promotion, or a
// missing letter on a promotion, never matches.
func findLegal(pos *chess.Position, uci string) *chess.Move {
	for _, m := range pos.ValidMoves() {
		if moveUCI(&m) == uci {
			return &m
		}
	}
	return nil
}

func moveUCI(m *chess.Move) string {
	s := m.S1().String() + m.S2().String()
	switch m.Promo() {
	case chess.Queen:
		s += "q"
	case chess.Rook:
		s += "r"
	case chess.Bishop:
		s += "b"
	case chess.Knight:
		s += "n"
	case chess.NoPieceType, chess.King, chess.Pawn:
	}
	return s
}

func pieceName(t chess.PieceType) Piece {
	switch t {
	case chess.Pawn:
		return Pawn
	case chess.Knight:
		return Knight
	case chess.Bishop:
		return Bishop
	case chess.Rook:
		return Rook
	case chess.Queen:
		return Queen
	case chess.King:
		return King
	case chess.NoPieceType:
	}
	return ""
}

// targetKey is the first two FEN fields: placement and side to move.
func targetKey(pos *chess.Position) string {
	fields := strings.Fields(pos.String())
	if len(fields) < 2 {
		return pos.String()
	}
	return fields[0] + " " + fields[1]
}
