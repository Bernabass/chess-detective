import { useParams } from 'react-router';
import { Placeholder } from '../components/Placeholder';
import { useTitle } from '../lib/useTitle';

export function ArchivePage() {
  useTitle('Archive');
  return (
    <Placeholder
      title="Archive"
      lead="Every past daily puzzle, playable in practice mode (it doesn't touch your streak)."
    />
  );
}

export function LeaderboardPage() {
  useTitle('Leaderboard');
  return (
    <Placeholder
      title="Leaderboard"
      lead="Today's fastest detectives and the all-time ranking: fewer guesses and hints rank higher."
    />
  );
}

export function ProfilePage() {
  const { username = '' } = useParams();
  useTitle(username);
  return (
    <Placeholder
      title={username}
      lead="Solved cases, streaks and a guess-distribution chart will appear on public profiles."
    />
  );
}
