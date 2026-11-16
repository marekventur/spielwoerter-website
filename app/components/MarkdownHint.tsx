/** One-line reminder under discussion text boxes; rendering is lib/post-markdown.ts. */
export function MarkdownHint() {
  return (
    <p className="text-xs text-gray-400 mt-1">
      Formatierung mit Markdown: **fett**, *kursiv*, [Linktext](https://…), Listen mit „- “, Zitate mit „&gt; “.
      Links werden automatisch erkannt.
    </p>
  );
}
