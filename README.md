# omp-bifrost-codemode

omp extension that draws Bifrost code-mode calls (`executeToolCode`, `listToolFiles`, `readToolFile`, `getToolDocs`) as compact cards: called tools, print output, result, error line, signatures.

![Compact Bifrost code-mode cards in omp](screenshot.png)

```sh
omp plugin install github:Xytronix/omp-bifrost-codemode
omp config set extensionRenderers.transcriptPresenters true
```

Expand a card (`Ctrl+O`) for the full output.

MIT
