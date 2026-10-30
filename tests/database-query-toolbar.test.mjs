/* oxlint-disable react/react-compiler -- These SSR-only harnesses capture rendered elements and callbacks for behavior assertions. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const noop = () => {};
const properties = [
  { id: 'title', name: 'Name', type: 'text' },
  { id: 'notes', name: 'Description', type: 'text' },
  { id: 'effort', name: 'Effort', type: 'number' },
  {
    id: 'priority',
    name: 'Priority',
    type: 'select',
    options: [{ id: 'high', name: 'High priority', color: 'red' }],
  },
  {
    id: 'tags',
    name: 'Labels',
    type: 'multiSelect',
    options: [{ id: 'research', name: 'Research', color: 'blue' }],
  },
  {
    id: 'status',
    name: 'Status',
    type: 'status',
    options: [{ id: 'done', name: 'Done', color: 'green', group: 'done' }],
  },
  { id: 'due', name: 'Due date', type: 'date' },
  { id: 'checked', name: 'Acknowledged', type: 'checkbox' },
  { id: 'created', name: 'Created time', type: 'createdAt' },
  { id: 'updated', name: 'Updated time', type: 'updatedAt' },
  { id: 'files', name: 'Attachments', type: 'files' },
];
const view = { id: 'table-view', name: 'All tasks', type: 'table', sorts: [] };
const database = {
  id: 'toolbar-database',
  title: 'Tasks',
  properties: properties.slice(1),
  records: [],
  view,
  createdAt: '2026-10-18T00:00:00.000Z',
  updatedAt: '2026-10-18T00:00:00.000Z',
};
const rule = (id, propertyId = 'title', values = {}) => ({
  id,
  propertyId,
  operator: 'contains',
  ...values,
});
const group = (id, conjunction, ...rules) => ({ id, conjunction, rules });

function elements(tree, predicate) {
  if (Array.isArray(tree))
    return tree.flatMap((child) => elements(child, predicate));
  if (!React.isValidElement(tree)) return [];
  return [
    ...(predicate(tree) ? [tree] : []),
    ...elements(tree.props.children, predicate),
  ];
}

function renderComponent(Component, props) {
  let tree;
  function Harness() {
    tree = Component(props);
    return tree;
  }
  return {
    html: renderToStaticMarkup(React.createElement(Harness)),
    get tree() {
      return tree;
    },
  };
}

void test('database query toolbar renders and edits the existing query model', async (context) => {
  const temporary = await mkdtemp(
    join(root, 'tests', '.database-query-toolbar-'),
  );
  try {
    const entry = join(temporary, 'entry.ts');
    await writeFile(
      entry,
      [
        "export * from '../../app/database-query-toolbar.tsx';",
        "export * from '../../app/database-query-settings.tsx';",
      ].join('\n'),
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
          output: { format: 'es', entryFileNames: 'query-toolbar.mjs' },
        },
      },
    });
    const {
      useDatabaseQueryToolbar,
      DatabaseQueryPropertyList,
      DatabaseSortSettings,
      DatabaseFilterSettings,
      DatabaseFilterRuleEditor,
      DatabaseFilterChoices,
      reorderDatabaseSorts,
    } = await import(pathToFileURL(join(temporary, 'query-toolbar.mjs')).href);
    const renderToolbar = (activeView = view, options = {}) => {
      let api;
      let opened = false;
      let toggles = 0;
      let beforeCalls = 0;
      function Harness() {
        api = useDatabaseQueryToolbar({
          database,
          view: activeView,
          patch: options.patch ?? noop,
          beforeOpen: () => {
            beforeCalls += 1;
            return options.allowed !== false;
          },
        });
        if (options.open && !opened) {
          opened = true;
          api[options.open]();
        }
        if (options.toggle && toggles < (options.toggleCount ?? 1)) {
          toggles += 1;
          const control = elements(
            api.buttons,
            (element) => element.key === options.toggle,
          )[0];
          control.props.onOpenChange(true);
        }
        return React.createElement(React.Fragment, null, api.buttons, api.bar);
      }
      const html = renderToStaticMarkup(React.createElement(Harness));
      return { html, api, beforeCalls };
    };
    const popover = (api, anchor) =>
      elements([api.buttons, api.bar], (element) => element.key === anchor)[0];
    const popupContent = (element) =>
      React.Children.toArray(element.props.children)[1].props.children;

    await context.test(
      'empty view shows only icon controls and no condition row',
      () => {
        const { html, api } = renderToolbar();
        assert.match(html, /aria-label="Filter records"/);
        assert.match(html, /aria-label="Sort records"/);
        assert.equal(api.bar, null);
        assert.doesNotMatch(
          html,
          /database-query-bar|database-query-badge|database-query-chip/,
        );
      },
    );

    await context.test(
      'the first sort or filter opening selects a field before creating a condition',
      () => {
        const patches = [];
        const sort = renderToolbar(view, {
          open: 'openSort',
          patch: (patch) => patches.push(patch),
        });
        const sortPopup = popover(sort.api, 'sort-icon');
        assert.equal(sortPopup.props.open, true);
        const sortPicker = popupContent(sortPopup);
        assert.equal(sortPicker.type, DatabaseQueryPropertyList);
        assert.equal(sortPicker.props.properties.length, properties.length);
        assert.deepEqual(patches, []);
        sortPicker.props.onSelect(properties[2]);
        assert.deepEqual(patches, [
          { sorts: [{ propertyId: 'effort', direction: 'asc' }] },
        ]);
        const filter = renderToolbar(view, { open: 'openFilter' });
        const filterPopup = popover(filter.api, 'filter-icon');
        assert.equal(filterPopup.props.open, true);
        assert.equal(popupContent(filterPopup).type, DatabaseQueryPropertyList);
        assert.equal(sort.beforeCalls, 1);
        assert.equal(filter.beforeCalls, 1);
      },
    );

    await context.test(
      'opening is vetoed while pending edits cannot be committed',
      () => {
        for (const open of ['openSort', 'openFilter']) {
          const rendered = renderToolbar(view, { open, allowed: false });
          assert.equal(rendered.beforeCalls, 1);
          assert.equal(popover(rendered.api, 'sort-icon').props.open, false);
          assert.equal(popover(rendered.api, 'filter-icon').props.open, false);
        }
      },
    );

    await context.test(
      'active sorting and filters occupy one separate condition row',
      () => {
        const activeView = {
          ...view,
          sorts: [
            { propertyId: 'title', direction: 'desc' },
            { propertyId: 'effort', direction: 'asc' },
          ],
          filter: group(
            'root',
            'and',
            rule('name-rule'),
            group(
              'advanced',
              'or',
              rule('status-rule', 'status', { operator: 'eq', value: 'done' }),
              rule('effort-rule', 'effort', { operator: 'gt', value: 3 }),
            ),
          ),
        };
        const { html, api } = renderToolbar(activeView);
        assert.equal(
          (html.match(/class="database-query-bar"/g) ?? []).length,
          1,
        );
        assert.match(html, /aria-label="Edit sorting"/);
        assert.match(html, /aria-label="Edit filter: Name"/);
        assert.match(html, /aria-label="Edit filter: 2 rules"/);
        assert.match(html, /aria-label="Add filter"/);
        assert.equal(
          (html.match(/class="database-query-chip"/g) ?? []).length,
          3,
        );
        assert.ok(popover(api, 'sort-chip'));
        assert.ok(popover(api, 'name-rule'));
        assert.ok(popover(api, 'advanced'));
        assert.ok(
          html.indexOf('Edit sorting') < html.indexOf('Edit filter: 2 rules'),
        );
        assert.ok(
          html.indexOf('Edit filter: 2 rules') <
            html.indexOf('Edit filter: Name'),
        );
      },
    );

    await context.test(
      'active toolbar icons hide and restore only the condition row',
      () => {
        const activeView = {
          ...view,
          sorts: [{ propertyId: 'title', direction: 'asc' }],
          filter: group(
            'active',
            'and',
            rule('named', 'title', { value: 'notes' }),
          ),
        };
        for (const toggle of ['filter-icon', 'sort-icon']) {
          const patches = [];
          const hidden = renderToolbar(activeView, {
            toggle,
            patch: (value) => patches.push(value),
          });
          assert.equal(hidden.api.bar, null);
          assert.equal(popover(hidden.api, toggle).props.open, false);
          assert.match(hidden.html, /data-active="true"/);
          const restored = renderToolbar(activeView, {
            toggle,
            toggleCount: 2,
          });
          assert.ok(restored.api.bar);
          assert.deepEqual(patches, []);
          const vetoed = renderToolbar(activeView, { toggle, allowed: false });
          assert.ok(vetoed.api.bar);
        }
      },
    );

    await context.test(
      'one advanced summary preserves multiple group trees and quick filters',
      () => {
        const quick = rule('quick', 'title', { value: 'notes' });
        const first = group(
          'first-group',
          'or',
          rule('one', 'title', { value: 'one' }),
        );
        const second = group(
          'second-group',
          'and',
          rule('two', 'title', { value: 'two' }),
        );
        const filter = group('root', 'and', quick, first, second);
        const patches = [];
        const rendered = renderToolbar(
          { ...view, filter },
          { patch: (value) => patches.push(value) },
        );
        assert.equal(
          (rendered.html.match(/data-kind="filter-group"/g) ?? []).length,
          1,
        );
        assert.ok(
          rendered.html.indexOf('Edit filter: 2 rules') <
            rendered.html.indexOf('Edit filter: Name'),
        );
        const editors = elements(
          popupContent(popover(rendered.api, 'first-group')),
          (element) => element.type === DatabaseFilterSettings,
        );
        assert.equal(editors.length, 2);
        editors[1].props.patch({ filter: { ...second, conjunction: 'or' } });
        assert.equal(patches[0].filter.rules[0], quick);
        assert.equal(patches[0].filter.rules[1], first);
        assert.equal(patches[0].filter.rules[2].conjunction, 'or');
        assert.equal(second.conjunction, 'and');
      },
    );

    await context.test(
      'unfinished quick filters stay neutral until their value is complete',
      () => {
        const active = rule('active', 'status', {
          operator: 'eq',
          value: 'done',
        });
        const draft = rule('draft', 'status', { operator: 'eq' });
        const { api } = renderToolbar({
          ...view,
          filter: group('root', 'and', active, draft),
        });
        const trigger = (anchor) =>
          React.Children.toArray(popover(api, anchor).props.children)[0];
        assert.equal(trigger('active').props['data-active'], true);
        assert.equal(trigger('draft').props['data-active'], false);
        assert.equal(trigger('filter-icon').props['data-active'], true);
        const incomplete = renderToolbar({
          ...view,
          filter: group('root', 'and', draft),
        });
        assert.equal(
          React.Children.toArray(
            popover(incomplete.api, 'filter-icon').props.children,
          )[0].props['data-active'],
          false,
        );
      },
    );

    await context.test(
      'OR roots remain one advanced chip and editing a leaf preserves its AND siblings',
      () => {
        const orView = {
          ...view,
          filter: group('root-or', 'or', rule('red'), rule('blue')),
        };
        const rendered = renderToolbar(orView);
        assert.match(rendered.html, /aria-label="Edit filter: 2 rules"/);
        assert.doesNotMatch(rendered.html, /aria-label="Edit filter: Name"/);
        const advanced = elements(
          popupContent(popover(rendered.api, 'root-or')),
          (element) => element.type === DatabaseFilterSettings,
        )[0];
        assert.equal(advanced.props.depthOffset, 0);
        const original = group(
          'root-and',
          'and',
          rule('first'),
          rule('second', 'notes'),
        );
        const patches = [];
        const simple = renderToolbar(
          { ...view, filter: original },
          { patch: (patch) => patches.push(patch) },
        );
        const editor = elements(
          popupContent(popover(simple.api, 'first')),
          (element) => element.type === DatabaseFilterRuleEditor,
        )[0];
        assert.equal(editor.props.compact, true);
        editor.props.onChange({ ...original.rules[0], value: 'edited' });
        assert.equal(patches[0].filter.conjunction, 'and');
        assert.equal(patches[0].filter.rules[0].value, 'edited');
        assert.equal(patches[0].filter.rules[1], original.rules[1]);
        assert.equal(original.rules[0].value, undefined);
      },
    );

    await context.test(
      'field lists display each supplied field with its type icon and a search box',
      () => {
        const { html } = renderComponent(DatabaseQueryPropertyList, {
          properties,
          onSelect: noop,
          label: 'Choose a sort field',
        });
        assert.match(
          html,
          /type="search"[^>]*aria-label="Choose a sort field"/,
        );
        assert.equal(
          (html.match(/class="database-setting-row"/g) ?? []).length,
          properties.length,
        );
        for (const property of properties)
          assert.ok(html.includes(`<span>${property.name}</span>`));
        assert.match(html, /title-outlined\.svg/);
        assert.match(html, /numbers-outlined\.svg/);
        assert.match(html, /calendar-month-outlined\.svg/);
        assert.match(html, /attach-file-outlined\.svg/);
        const selected = [];
        const captured = renderComponent(DatabaseQueryPropertyList, {
          properties,
          onSelect: (property) => selected.push(property),
        });
        const buttons = elements(
          captured.tree,
          (element) => element.type === 'button',
        );
        buttons[2].props.onClick();
        assert.equal(selected[0], properties[2]);
      },
    );

    await context.test(
      'sort rows expose field, direction, removal, and an accessible drag handle horizontally',
      () => {
        const sorts = [
          { propertyId: 'title', direction: 'asc' },
          { propertyId: 'effort', direction: 'desc' },
        ];
        const patches = [];
        const captured = renderComponent(DatabaseSortSettings, {
          database,
          view: { ...view, sorts },
          patch: (patch) => patches.push(patch),
        });
        assert.equal(
          (captured.html.match(/class="database-sort-row"/g) ?? []).length,
          2,
        );
        assert.equal(
          (captured.html.match(/draggable="true"/g) ?? []).length,
          2,
        );
        assert.match(captured.html, /aria-keyshortcuts="ArrowUp ArrowDown"/);
        assert.doesNotMatch(
          captured.html,
          /Priority [12]|Move sort up|Move sort down/,
        );
        const handles = elements(
          captured.tree,
          (element) => element.props.className === 'database-query-drag-handle',
        );
        let prevented = false;
        handles[1].props.onKeyDown({
          key: 'ArrowUp',
          preventDefault: () => {
            prevented = true;
          },
        });
        assert.equal(prevented, true);
        assert.deepEqual(
          patches[0].sorts.map((sort) => sort.propertyId),
          ['effort', 'title'],
        );
        const selects = elements(
          captured.tree,
          (element) => element.type === 'select',
        );
        const titleOptions = React.Children.toArray(
          selects[0].props.children,
        ).map((option) => option.props.value);
        assert.ok(titleOptions.includes('title'));
        assert.ok(!titleOptions.includes('effort'));
      },
    );

    await context.test(
      'reordering moves precedence immutably and ignores unknown or unchanged targets',
      () => {
        const sorts = [
          { propertyId: 'title', direction: 'asc' },
          { propertyId: 'status', direction: 'desc' },
          { propertyId: 'due', direction: 'asc' },
        ];
        const next = reorderDatabaseSorts(sorts, 'title', 'due');
        assert.deepEqual(
          next.map((sort) => sort.propertyId),
          ['status', 'due', 'title'],
        );
        assert.equal(next[2], sorts[0]);
        assert.deepEqual(
          sorts.map((sort) => sort.propertyId),
          ['title', 'status', 'due'],
        );
        assert.equal(reorderDatabaseSorts(sorts, 'missing', 'title'), sorts);
        assert.equal(reorderDatabaseSorts(sorts, 'title', 'missing'), sorts);
        assert.equal(reorderDatabaseSorts(sorts, 'title', 'title'), sorts);
      },
    );

    await context.test(
      'quick filters prioritize values and offer one header delete action',
      () => {
        let removed = 0;
        const updates = [];
        const compact = renderComponent(DatabaseFilterRuleEditor, {
          compact: true,
          node: rule('quick', 'priority', { operator: 'eq', value: 'high' }),
          properties,
          onChange: (node) => updates.push(node),
          onRemove: () => removed++,
        });
        assert.match(compact.html, /database-quick-filter-header/);
        assert.doesNotMatch(
          compact.html,
          /database-filter-row|Filter property|Remove condition/,
        );
        assert.match(compact.html, /type="checkbox"/);
        assert.match(compact.html, /High priority/);
        const operator = elements(
          compact.tree,
          (element) => element.props['aria-label'] === 'Filter operator',
        )[0];
        operator.props.onChange({ target: { value: 'neq' } });
        assert.equal(updates[0].value, 'high');
        operator.props.onChange({ target: { value: 'empty' } });
        assert.equal(updates[1].value, undefined);
        elements(
          compact.tree,
          (element) => element.props['aria-label'] === 'Delete filter',
        )[0].props.onClick();
        assert.equal(removed, 1);
      },
    );

    await context.test(
      'choice filter search preserves selections and supports repeated checkbox toggles',
      () => {
        const choice = {
          id: 'labels',
          name: 'Labels',
          type: 'multiSelect',
          options: [
            { id: 'a', name: 'Alpha', color: 'red' },
            { id: 'b', name: 'Beta', color: 'blue' },
          ],
        };
        let captured;
        let phase = 0;
        let finalValue;
        function Harness() {
          const [value, setValue] = React.useState('a');
          finalValue = value;
          captured = DatabaseFilterChoices({
            property: choice,
            value,
            onChange: setValue,
          });
          const checkboxes = elements(
            captured,
            (element) => element.props.type === 'checkbox',
          );
          if (phase === 0) {
            assert.equal(checkboxes[0].props.checked, true);
            phase++;
            checkboxes[1].props.onChange();
          } else if (phase === 1) {
            assert.deepEqual(value, ['a', 'b']);
            phase++;
            elements(
              captured,
              (element) => element.props.type === 'search',
            )[0].props.onChange({ target: { value: 'BETA' } });
          } else if (phase === 2) {
            assert.equal(checkboxes.length, 1);
            assert.equal(checkboxes[0].props.checked, true);
            phase++;
            checkboxes[0].props.onChange();
          } else {
            assert.equal(value, 'a');
            assert.equal(checkboxes[0].props.checked, false);
          }
          return captured;
        }
        renderToStaticMarkup(React.createElement(Harness));
        assert.equal(phase, 3);
        assert.equal(finalValue, 'a');
        const values = [];
        const last = renderComponent(DatabaseFilterChoices, {
          property: choice,
          value: 'a',
          onChange: (value) => values.push(value),
        });
        elements(
          last.tree,
          (element) => element.props.type === 'checkbox',
        )[0].props.onChange();
        assert.equal(values[0], undefined);
      },
    );

    await context.test(
      'quick date filters display a calendar, relative presets, and typed range values',
      () => {
        const updates = [];
        const single = renderComponent(DatabaseFilterRuleEditor, {
          compact: true,
          node: rule('date', 'due', { operator: 'eq', value: '2026-10-20' }),
          properties,
          onChange: (value) => updates.push(value),
        });
        const calendar = elements(
          single.tree,
          (element) => element.props.className === 'database-date-calendar',
        )[0];
        assert.equal(calendar.props.mode, 'single');
        calendar.props.onSelect(new Date(2026, 9, 24));
        assert.equal(updates[0].value, '2026-10-24');
        const range = renderComponent(DatabaseFilterRuleEditor, {
          compact: true,
          node: rule('date', 'due', { operator: 'between' }),
          properties,
          onChange: (value) => updates.push(value),
        });
        const rangeCalendar = elements(
          range.tree,
          (element) => element.props.className === 'database-date-calendar',
        )[0];
        assert.equal(rangeCalendar.props.mode, 'range');
        rangeCalendar.props.onSelect({
          from: new Date(2026, 9, 20),
          to: new Date(2026, 9, 24),
        });
        assert.equal(updates[1].value, '2026-10-20');
        assert.equal(updates[1].endValue, '2026-10-24');
        const relative = renderComponent(DatabaseFilterRuleEditor, {
          compact: true,
          node: rule('date', 'due', { operator: 'relative', value: 'today' }),
          properties,
          onChange: (value) => updates.push(value),
        });
        const presets = elements(
          relative.tree,
          (element) => element.props.type === 'radio',
        );
        assert.equal(presets.length, 5);
        presets[1].props.onChange();
        assert.equal(updates[2].value, 'thisWeek');
        const empty = renderComponent(DatabaseFilterRuleEditor, {
          compact: true,
          node: rule('date', 'due', { operator: 'empty' }),
          properties,
          onChange: noop,
        });
        assert.doesNotMatch(empty.html, /<input|database-date-calendar/);
      },
    );

    await context.test(
      'quick numeric and checkbox filters keep typed edits and zero or false values',
      () => {
        const updates = [];
        const numeric = renderComponent(DatabaseFilterRuleEditor, {
          compact: true,
          node: rule('number', 'effort', { operator: 'gte', value: 0 }),
          properties,
          onChange: (value) => updates.push(value),
        });
        const input = elements(
          numeric.tree,
          (element) => element.props['aria-label'] === 'Filter value',
        )[0];
        assert.equal(input.props.type, 'number');
        assert.equal(input.props.value, 0);
        input.props.onChange({
          currentTarget: { value: '2.5', validity: { valid: true } },
        });
        assert.equal(updates[0].value, 2.5);
        const checked = renderComponent(DatabaseFilterRuleEditor, {
          compact: true,
          node: rule('checked', 'checked', { operator: 'eq', value: true }),
          properties,
          onChange: (value) => updates.push(value),
        });
        elements(
          checked.tree,
          (element) => element.props.type === 'radio',
        )[1].props.onChange();
        assert.equal(updates[1].value, false);
      },
    );

    await context.test(
      'advanced editing retains choice arrays created by a quick filter',
      () => {
        const updates = [];
        const captured = renderComponent(DatabaseFilterRuleEditor, {
          node: rule('advanced', 'priority', {
            operator: 'eq',
            value: ['high'],
          }),
          properties,
          onChange: (value) => updates.push(value),
        });
        const input = elements(
          captured.tree,
          (element) => element.props['aria-label'] === 'Filter value',
        )[0];
        assert.equal(input.props.multiple, true);
        assert.deepEqual(input.props.value, ['high']);
        input.props.onChange({ target: { selectedOptions: [] } });
        assert.deepEqual(updates[0].value, []);
      },
    );

    await context.test(
      'all ten field types retain their supported value controls and operators',
      () => {
        const cases = [
          ['notes', 'contains', 'text', 'read the full notice'],
          ['effort', 'gte', 'number', 2.5],
          ['priority', 'eq', 'select', 'high'],
          ['tags', 'eq', 'select', 'research'],
          ['status', 'eq', 'select', 'done'],
          ['due', 'eq', 'date', '2026-11-16'],
          ['checked', 'eq', 'select', false],
          ['created', 'lt', 'date', '2026-10-18'],
          ['updated', 'gte', 'date', '2026-10-18'],
          ['files', 'contains', 'text', 'notice.pdf'],
        ];
        for (const [propertyId, operator, inputType, value] of cases) {
          const captured = renderComponent(DatabaseFilterRuleEditor, {
            node: rule(`rule-${propertyId}`, propertyId, { operator, value }),
            properties,
            prefix: 'Where',
            onChange: noop,
            onRemove: noop,
          });
          assert.match(captured.html, /class="database-filter-row"/);
          assert.match(
            captured.html,
            /class="database-filter-prefix">Where<\/div>/,
          );
          assert.match(captured.html, /aria-label="Filter property"/);
          assert.match(captured.html, /aria-label="Filter operator"/);
          const values = elements(
            captured.tree,
            (element) => element.props['aria-label'] === 'Filter value',
          );
          assert.equal(values.length, 1, propertyId);
          assert.equal(
            values[0].type,
            inputType === 'select' ? 'select' : 'input',
            propertyId,
          );
          if (inputType !== 'select')
            assert.equal(values[0].props.type, inputType, propertyId);
          assert.equal(
            String(values[0].props.value),
            String(value),
            propertyId,
          );
        }
      },
    );

    await context.test(
      'between, relative-date, and empty conditions show only the necessary controls',
      () => {
        const between = renderComponent(DatabaseFilterRuleEditor, {
          node: rule('range', 'effort', {
            operator: 'between',
            value: 1,
            endValue: 5,
          }),
          properties,
          onChange: noop,
        });
        assert.equal(
          elements(between.tree, (element) => element.type === 'input').length,
          2,
        );
        assert.match(between.html, /aria-label="End value"/);
        assert.doesNotMatch(between.html, /database-query-warning/);
        const invalid = renderComponent(DatabaseFilterRuleEditor, {
          node: rule('range', 'effort', {
            operator: 'between',
            value: 5,
            endValue: 1,
          }),
          properties,
          onChange: noop,
        });
        assert.match(invalid.html, /The start must not exceed the end/);
        const relative = renderComponent(DatabaseFilterRuleEditor, {
          node: rule('relative', 'due', {
            operator: 'relative',
            value: 'past7Days',
          }),
          properties,
          onChange: noop,
        });
        assert.match(relative.html, /value="past7Days" selected=""/);
        assert.doesNotMatch(relative.html, /<input/);
        const empty = renderComponent(DatabaseFilterRuleEditor, {
          node: rule('empty', 'files', { operator: 'empty' }),
          properties,
          onChange: noop,
        });
        assert.doesNotMatch(empty.html, /aria-label="Filter value"|<input/);
      },
    );

    await context.test(
      'switching field types or operators discards stale values and uses typed defaults',
      () => {
        const updates = [];
        const captured = renderComponent(DatabaseFilterRuleEditor, {
          node: rule('typed', 'effort', {
            operator: 'between',
            value: 1,
            endValue: 5,
          }),
          properties,
          onChange: (node) => updates.push(node),
        });
        const property = elements(
          captured.tree,
          (element) => element.props['aria-label'] === 'Filter property',
        )[0];
        property.props.onChange({ target: { value: 'checked' } });
        assert.deepEqual(updates[0], {
          id: 'typed',
          propertyId: 'checked',
          operator: 'eq',
          value: true,
        });
        const operator = elements(
          captured.tree,
          (element) => element.props['aria-label'] === 'Filter operator',
        )[0];
        operator.props.onChange({ target: { value: 'empty' } });
        assert.equal(updates[1].value, undefined);
        assert.equal(updates[1].endValue, undefined);
      },
    );

    await context.test(
      'native numeric and date input events keep valid typed values and reject invalid values',
      () => {
        for (const [propertyId, value, expected] of [
          ['effort', '12.5', 12.5],
          ['due', '2026-11-16', '2026-11-16'],
        ]) {
          const updates = [];
          const captured = renderComponent(DatabaseFilterRuleEditor, {
            node: rule('native', propertyId, { operator: 'eq' }),
            properties,
            onChange: (node) => updates.push(node),
          });
          const input = elements(
            captured.tree,
            (element) => element.props['aria-label'] === 'Filter value',
          )[0];
          input.props.onInput({
            currentTarget: { value, validity: { valid: true } },
          });
          assert.equal(updates[0].value, expected);
          input.props.onChange({
            currentTarget: { value: '', validity: { valid: true } },
          });
          assert.equal(updates[1].value, undefined);
          input.props.onInput({
            currentTarget: { value: 'invalid', validity: { valid: false } },
          });
          assert.equal(updates.length, 2);
        }
      },
    );

    await context.test(
      'advanced groups use true nesting depth and global limits for adding conditions',
      () => {
        const local = group('local', 'or', rule('local-rule'));
        const atMaximumDepth = renderComponent(DatabaseFilterSettings, {
          database,
          view: { ...view, filter: local },
          depthOffset: 2,
          patch: noop,
        });
        assert.match(atMaximumDepth.html, /data-depth="2"/);
        assert.match(
          atMaximumDepth.html,
          /aria-label="Group condition combination"/,
        );
        assert.doesNotMatch(
          atMaximumDepth.html,
          /aria-label="Add condition group"/,
        );
        const fullRoot = group(
          'full-root',
          'and',
          local,
          ...Array.from({ length: 39 }, (_, index) => rule(`full-${index}`)),
        );
        const full = renderComponent(DatabaseFilterSettings, {
          database,
          view: { ...view, filter: local },
          depthOffset: 1,
          limitRoot: fullRoot,
          patch: noop,
        });
        const triggers = elements(
          full.tree,
          (element) =>
            element.props.label === 'Add condition' ||
            element.props.label === 'Add condition group',
        );
        assert.equal(triggers.length, 2);
        assert.ok(triggers.every((trigger) => trigger.props.disabled));
        const empty = renderComponent(DatabaseFilterSettings, {
          database,
          view,
          patch: noop,
        });
        assert.match(empty.html, /aria-label="Add condition"/);
        assert.doesNotMatch(empty.html, /aria-label="Filter property"/);
      },
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
