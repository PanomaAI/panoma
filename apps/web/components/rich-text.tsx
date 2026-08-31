import type { ReactNode } from "react";

/**
 * A translated text that is marked inside.
 *
 * Half a dozen sentences in the interface have a `<code>` or a `<strong>` in the middle of the
 * sentence —"a key in a `.env` ignored is on your disk"—, and until now that forced a choice
 * between two bad options: leaving the whole sentence out of the dictionary, or splitting it into
 * pieces ("…a key in a " + " ignored is on your disk…"). The second is worse than it seems: the
 * word order is not preserved when translating, so the pieces only fit in the language they were
 * written in.
 *
 * With this, the sentence stays as a single piece in the dictionary, with a `{env}` gap where the
 * markup goes, and each language places the gap where its grammar requires. What is replaced are
 * React nodes, not HTML: no `dangerouslySetInnerHTML` to put some `<code>` tags.
 */
export function Rich({ text, slots }: { text: string; slots: Record<string, ReactNode> }) {
  // Chop through the gaps keeping them: `split` with a capturing group returns them interleaved, so
  // the odd positions are always placeholder names.
  const pieces = text.split(/\{(\w+)\}/g);

  return (
    <>
      {pieces.map((piece, index) => {
        if (index % 2 === 0) return piece;
        // A gap without a node remains written as is, just like `t` does with the variables: see
        // `{env}` on screen leads up to here; a mutilated sentence, no.
        return <span key={index}>{slots[piece] ?? `{${piece}}`}</span>;
      })}
    </>
  );
}
