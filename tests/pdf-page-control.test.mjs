/* oxlint-disable react/react-compiler -- The SSR harness drives the real page input through render-phase updates. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const key = (input, value) =>
  input.props.onKeyDown({
    key: value,
    preventDefault() {},
    stopPropagation() {},
  });
const change =
  (value) =>
  ({ input }) =>
    input.props.onChange({ target: { value } });
const blur = ({ input }) => input.props.onBlur();

void test('PDF page entry only jumps on an edited blur or explicit Enter', async (context) => {
  const temporary = await mkdtemp(join(root, 'tests', '.pdf-page-control-'));
  try {
    const entry = join(temporary, 'entry.ts');
    await writeFile(
      entry,
      "export { PdfPageControl } from '../../app/pdf-navigation.tsx';\n",
    );
    await build({
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: { '@': root } },
      build: {
        ssr: entry,
        outDir: temporary,
        emptyOutDir: false,
        minify: false,
        rolldownOptions: {
          output: { format: 'es', entryFileNames: 'page-control.mjs' },
        },
      },
    });
    const { PdfPageControl } = await import(
      pathToFileURL(join(temporary, 'page-control.mjs')).href
    );
    const run = (steps, initialPage = 2) => {
      const calls = [];
      let index = 0;
      let input;
      function Harness() {
        const [page, setPage] = React.useState(initialPage);
        const [, refresh] = React.useState(0);
        const tree = PdfPageControl({
          page,
          total: 10,
          onPage(target) {
            calls.push(target);
            setPage(target);
          },
        });
        input = React.Children.toArray(tree.props.children)[0];
        if (index < steps.length) {
          steps[index++]({ input, page, setPage });
          refresh((value) => value + 1);
        }
        return tree;
      }
      renderToStaticMarkup(React.createElement(Harness));
      return { calls, input };
    };

    await context.test(
      'focusing and leaving the current page cannot rewind scrolling',
      () => {
        const { calls } = run([blur, blur]);
        assert.deepEqual(calls, []);
      },
    );

    await context.test(
      'Enter deliberately jumps to the same page and its blur stays quiet',
      () => {
        const { calls } = run([
          ({ input }) => {
            key(input, 'Enter');
            input.props.onBlur();
          },
          blur,
        ]);
        assert.deepEqual(calls, [2]);
      },
    );

    await context.test(
      'an edited Enter followed immediately by blur submits once',
      () => {
        const { calls, input } = run([
          change('4'),
          ({ input }) => {
            key(input, 'Enter');
            input.props.onBlur();
          },
          blur,
        ]);
        assert.deepEqual(calls, [4]);
        assert.equal(input.props.value, '4');
      },
    );

    await context.test(
      'edited blur commits once and clamps to the document',
      () => {
        const { calls, input } = run([change('99'), blur, blur]);
        assert.deepEqual(calls, [10]);
        assert.equal(input.props.value, '10');
      },
    );

    await context.test(
      'Escape and invalid entries clear the edit without a page jump',
      () => {
        for (const steps of [
          [change('4'), ({ input }) => key(input, 'Escape'), blur],
          [change('invalid'), blur, blur],
          [change('0'), ({ input }) => key(input, 'Enter'), blur],
        ]) {
          const { calls, input } = run(steps);
          assert.deepEqual(calls, []);
          assert.equal(input.props.value, '2');
        }
      },
    );

    await context.test(
      'scrolling to another page invalidates the previous page draft on blur',
      () => {
        const { calls, input } = run([
          change('7'),
          ({ setPage }) => setPage(3),
          blur,
          blur,
        ]);
        assert.deepEqual(calls, []);
        assert.equal(input.props.value, '3');
      },
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
