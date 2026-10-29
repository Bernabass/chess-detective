import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';
import { useCopy } from '../../lib/clipboard';
import { shareText, type ShareInput } from './share';

/** The share card (SPEC §8.6): a preview of the text and a Copy button. */
export function ShareCard(props: Omit<ShareInput, 'origin'>) {
  const [state, copy] = useCopy();
  const text = shareText({ ...props, origin: window.location.origin });
  return (
    <div>
      <pre
        aria-label="Share text"
        data-testid="share-text"
        className="rounded-md border border-card-edge bg-paper px-3 py-2 font-mono text-sm leading-relaxed break-words whitespace-pre-wrap"
      >
        {text}
      </pre>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          onClick={() => {
            copy(text);
          }}
        >
          <Icon name="share" className="h-4 w-4" />
          Copy result
        </Button>
        <span role="status" className="text-sm text-ink-soft">
          {state === 'copied' && (
            <>
              <Icon name="check" className="mr-1 inline h-4 w-4 text-ok" />
              Copied. Paste it anywhere.
            </>
          )}
          {state === 'failed' && "Couldn't copy: select the text above and copy it."}
        </span>
      </div>
    </div>
  );
}
