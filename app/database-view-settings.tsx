'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Popover, PopoverContent } from '@/components/ui/popover';
import {
  ArrowLeft,
  ArrowUpDown,
  Check,
  ChevronRight,
  Columns3,
  Copy,
  Eye,
  Filter,
  Image,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  DatabaseFilterSettings,
  DatabaseSortSettings,
} from './database-query-settings';
import { databaseFilterCount } from './database-query';
import { databaseSorts } from './database-model';
import { propertyIcons } from './database-property-editor';
import { SettingsVisibility } from './vendor/ocean-dataview/settings-visibility';
import { useI18n } from './i18n';
import { MaterialIcon } from './material-icon';
import { databaseViewIcons } from './database-icons';
import {
  activeDatabaseView,
  addDatabaseView,
  databaseViews,
  databaseViewName,
  isGroupProperty,
  selectDatabaseView,
  updateDatabaseView,
  type DatabaseView,
  type WorkspaceDatabase,
} from './database-model';

export { databaseViewIcons } from './database-icons';
export type ViewSettingsSection =
  | 'main'
  | 'layout'
  | 'preview'
  | 'previewMedia'
  | 'visibility'
  | 'sort'
  | 'filter'
  | 'group'
  | 'properties';
type Update = (
  change: (current: WorkspaceDatabase) => WorkspaceDatabase,
) => void;

export function DatabaseViewTabs({
  database,
  update,
  onEdit,
  onRename,
  onDelete,
  onSelect,
}: {
  database: WorkspaceDatabase;
  update: Update;
  onEdit: () => void;
  onRename: (view: DatabaseView) => void;
  onDelete: (view: DatabaseView) => void;
  onSelect?: (id: string) => boolean;
}) {
  const { t, language } = useI18n();
  const views = databaseViews(database, language),
    active = activeDatabaseView(database, language);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const [menu, setMenu] = useState<string | null>(null);
  const focusTab = (id: string) => refs.current.get(id)?.focus();
  const select = (id: string) => {
    if (onSelect) return onSelect(id);
    update((current) => selectDatabaseView(current, id, language));
    return true;
  };
  const createView = (type: DatabaseView['type'], sourceId?: string) => {
    if (onSelect && !onSelect(active.id)) return false;
    // Generate outside the workspace updater so React can replay it safely.
    const id = crypto.randomUUID();
    update((current) =>
      addDatabaseView(current, type, language, sourceId, () => id),
    );
    onSelect?.(id);
    return true;
  };
  return (
    <div className="database-view-switcher">
      <div
        className="database-view-tabs"
        role="tablist"
        aria-label={t('Database views', '多维表视图')}
      >
        {views.map((view) => {
          const Icon = databaseViewIcons[view.type];
          return (
            <DropdownMenu
              key={view.id}
              modal={false}
              open={menu === view.id}
              onOpenChange={(open, details) => {
                if (open) {
                  const wasActive = view.id === active.id;
                  if (!select(view.id)) {
                    details.cancel();
                    return;
                  }
                  if (!wasActive) {
                    // Selecting a different tab only changes the view. Its
                    // menu becomes available on the next activation.
                    details.cancel();
                    setMenu(null);
                    return;
                  }
                }
                setMenu(open ? view.id : null);
              }}
            >
              <DropdownMenuTrigger
                ref={(el) => {
                  if (el) refs.current.set(view.id, el);
                  else refs.current.delete(view.id);
                }}
                role="tab"
                id={`database-view-${view.id}`}
                aria-controls="database-view-content"
                aria-selected={view.id === active.id}
                tabIndex={view.id === active.id ? 0 : -1}
                className="database-view-tab"
                title={view.name}
                onKeyDown={(event) => {
                  if (
                    !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(
                      event.key,
                    )
                  )
                    return;
                  event.preventDefault();
                  event.stopPropagation();
                  const index = views.findIndex((item) => item.id === view.id);
                  const next =
                    views[
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? views.length - 1
                          : (index +
                              (event.key === 'ArrowRight'
                                ? 1
                                : views.length - 1)) %
                            views.length
                    ];
                  setMenu(null);
                  if (select(next.id)) focusTab(next.id);
                }}
              >
                <Icon size={16} />
                <span>{view.name}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="lumior-menu database-view-menu"
                align="start"
              >
                <DropdownMenuItem onClick={() => onRename(view)}>
                  <Pencil size={14} />
                  {t('Rename', '重命名')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onEdit}>
                  <SlidersHorizontal size={14} />
                  {t('Edit view', '编辑视图')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => createView(view.type, view.id)}
                >
                  <Copy size={14} />
                  {t('Duplicate view', '创建视图副本')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={views.length === 1}
                  variant="destructive"
                  onClick={() => onDelete(view)}
                >
                  <Trash2 size={14} />
                  {t('Delete view', '删除视图')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="database-add-view"
          aria-label={t('Add view', '添加视图')}
          title={t('Add view', '添加视图')}
        >
          <MaterialIcon name="add" size={16} />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="lumior-menu database-view-menu"
          align="start"
        >
          {(['table', 'board', 'list', 'gallery'] as const).map((type) => {
            const Icon = databaseViewIcons[type];
            return (
              <DropdownMenuItem
                key={type}
                onClick={() => {
                  if (createView(type)) onEdit();
                }}
              >
                <Icon size={15} />
                {databaseViewName(type, language)}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function DatabaseViewSettings({
  anchor,
  database,
  update,
  section,
  onSection,
  onClose,
  onEditProperty,
  onAddProperty,
  onAddToBoard,
}: {
  anchor?: RefObject<HTMLElement | null>;
  database: WorkspaceDatabase;
  update: Update;
  section: ViewSettingsSection;
  onSection: (value: ViewSettingsSection) => void;
  onClose: () => void;
  onEditProperty: (id: string) => void;
  onAddProperty: () => void;
  onAddToBoard?: () => void;
}) {
  const { t, language } = useI18n();
  const view = activeDatabaseView(database, language);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const propertySearchInput = useRef<HTMLInputElement>(null);
  const [propertySearch, setPropertySearch] = useState('');
  const [name, setName] = useState(view.name);
  const [previous, setPrevious] = useState(`${view.id}:${view.name}`);
  if (previous !== `${view.id}:${view.name}`) {
    setPrevious(`${view.id}:${view.name}`);
    setName(view.name);
  }
  const patch = (values: Partial<DatabaseView>) =>
    update((current) => updateDatabaseView(current, view.id, values, language));
  const commitName = () => {
    if (name.trim()) patch({ name });
    else setName(view.name);
  };
  useEffect(() => {
    if (section === 'properties') {
      propertySearchInput.current?.focus();
    }
  }, [section]);
  const names = {
    main: t('View settings', '视图设置'),
    layout: t('Layout', '布局'),
    preview: t('Card preview', '卡片预览'),
    previewMedia: t('Media field', '媒体字段'),
    visibility: t('Property visibility', '字段可见设置'),
    sort: t('Sort', '排序'),
    filter: t('Filter', '筛选'),
    group: t('Group', '分组'),
    properties: t('Edit properties', '编辑字段'),
  };
  const visible =
    view.visiblePropertyIds ??
    database.properties.map((property) => property.id);
  const grouping =
    view.groupBy === undefined && view.type === 'board'
      ? database.properties.find(isGroupProperty)?.id
      : view.groupBy;
  const Icon = databaseViewIcons[view.type];
  const mediaProperties = database.properties.filter(
    (property) => property.type === 'files',
  );
  const previewPropertyId =
    view.cardPreview?.type === 'media' ? view.cardPreview.propertyId : null;
  const previewProperty = mediaProperties.find(
    (property) => property.id === previewPropertyId,
  );
  const matchingProperties = database.properties.filter((property) =>
    property.name
      .toLocaleLowerCase()
      .includes(propertySearch.trim().toLocaleLowerCase()),
  );
  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <PopoverContent
        anchor={anchor}
        align="end"
        side="bottom"
        sideOffset={8}
        ref={panel}
        initialFocus={panel}
        finalFocus={false}
        tabIndex={-1}
        className="database-view-settings"
        aria-label={t('View settings', '视图设置')}
      >
        <header>
          {section !== 'main' && (
            <button
              onClick={() =>
                onSection(
                  section === 'previewMedia'
                    ? 'preview'
                    : section === 'preview'
                      ? 'layout'
                      : 'main',
                )
              }
              aria-label={t('Back', '返回')}
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <h2>{names[section]}</h2>
          <button
            onClick={onClose}
            aria-label={t('Close view settings', '关闭视图设置')}
          >
            <X size={15} />
          </button>
        </header>
        <div className="database-view-settings-body" key={section}>
          {section === 'main' && (
            <>
              <label className="database-view-name-field">
                <Icon size={16} />
                <input
                  ref={input}
                  aria-label={t('View name', '视图名称')}
                  value={name}
                  maxLength={80}
                  onChange={(event) => setName(event.target.value)}
                  onBlur={commitName}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return;
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      event.stopPropagation();
                      setName(view.name);
                    }
                  }}
                />
              </label>
              {(
                [
                  ['layout', Icon, databaseViewName(view.type, language)],
                  ['visibility', Eye, `${visible.length + 1}`],
                  [
                    'filter',
                    Filter,
                    databaseFilterCount(view.filter) || t('None', '无'),
                  ],
                  [
                    'sort',
                    ArrowUpDown,
                    databaseSorts(view).length || t('None', '无'),
                  ],
                  [
                    'group',
                    Columns3,
                    database.properties.find(
                      (property) => property.id === grouping,
                    )?.name || t('None', '无'),
                  ],
                ] as const
              ).map(([key, RowIcon, value]) => (
                <button
                  key={key}
                  className="database-setting-row"
                  onClick={() => onSection(key)}
                >
                  <RowIcon size={16} />
                  <span>{names[key]}</span>
                  <small>{value}</small>
                  <ChevronRight size={14} />
                </button>
              ))}
              <div className="database-setting-divider" />
              <button
                className="database-setting-row"
                onClick={() => {
                  setPropertySearch('');
                  onSection('properties');
                }}
              >
                <SlidersHorizontal size={16} />
                <span>{names.properties}</span>
                <ChevronRight size={14} />
              </button>
              {onAddToBoard && (
                <button className="database-setting-row" onClick={onAddToBoard}>
                  <MaterialIcon name="dashboard" size={16} />
                  <span>{t('Add to board', '添加到画板')}</span>
                </button>
              )}
            </>
          )}
          {section === 'properties' && (
            <>
              <label className="database-view-name-field">
                <Search size={15} />
                <input
                  ref={propertySearchInput}
                  aria-label={t('Search properties', '搜索字段…')}
                  placeholder={t('Search properties…', '搜索字段…')}
                  value={propertySearch}
                  onChange={(event) => setPropertySearch(event.target.value)}
                />
              </label>
              {matchingProperties.map((property) => {
                const PropertyIcon = propertyIcons[property.type];
                return (
                  <button
                    key={property.id}
                    className="database-setting-row"
                    onClick={() => onEditProperty(property.id)}
                    title={property.name}
                  >
                    <PropertyIcon size={16} />
                    <span className="database-property-list-name">
                      {property.name}
                    </span>
                    <ChevronRight size={14} />
                  </button>
                );
              })}
              {matchingProperties.length === 0 && (
                <p className="database-settings-caption">
                  {t('No properties found.', '没有匹配的字段。')}
                </p>
              )}
              <div className="database-setting-divider" />
              <button className="database-setting-row" onClick={onAddProperty}>
                <Plus size={16} />
                <span>{t('Add property', '添加字段')}</span>
              </button>
            </>
          )}
          {section === 'layout' &&
            Object.entries(databaseViewIcons).map(([type, TypeIcon]) => (
              <button
                key={type}
                className="database-setting-row"
                aria-pressed={view.type === type}
                onClick={() => patch({ type: type as DatabaseView['type'] })}
              >
                <TypeIcon size={16} />
                <span>
                  {databaseViewName(type as DatabaseView['type'], language)}
                </span>
                {view.type === type && <Check size={15} />}
              </button>
            ))}
          {section === 'layout' && view.type === 'gallery' && (
            <>
              <div className="database-setting-divider" />
              <button
                className="database-setting-row"
                onClick={() => onSection('preview')}
              >
                <Image size={16} />
                <span>{names.preview}</span>
                <small>{previewProperty?.name || t('None', '无')}</small>
                <ChevronRight size={14} />
              </button>
              <button
                type="button"
                className="database-setting-row"
                role="switch"
                aria-checked={view.fitMedia !== false}
                onClick={() => patch({ fitMedia: view.fitMedia === false })}
              >
                <span>{t('Fit media', '适应媒体')}</span>
                <span
                  className="database-property-switch"
                  data-checked={view.fitMedia !== false}
                  aria-hidden="true"
                />
              </button>
            </>
          )}
          {section === 'preview' && (
            <>
              <button
                className="database-setting-row"
                aria-pressed={!previewProperty}
                onClick={() => patch({ cardPreview: { type: 'none' } })}
              >
                <span>{t('None', '无')}</span>
                {!previewProperty && <Check size={15} />}
              </button>
              <button
                className="database-setting-row"
                onClick={() => onSection('previewMedia')}
              >
                <Image size={16} />
                <span>{t('Media', '媒体')}</span>
                <small>{previewProperty?.name}</small>
                <ChevronRight size={14} />
              </button>
            </>
          )}
          {section === 'previewMedia' && (
            <>
              {mediaProperties.map((property) => {
                const PropertyIcon = propertyIcons.files;
                return (
                  <button
                    key={property.id}
                    className="database-setting-row"
                    aria-pressed={property.id === previewPropertyId}
                    onClick={() => {
                      patch({
                        cardPreview: { type: 'media', propertyId: property.id },
                      });
                      onSection('preview');
                    }}
                  >
                    <PropertyIcon size={16} />
                    <span>{property.name}</span>
                    {property.id === previewPropertyId && <Check size={15} />}
                  </button>
                );
              })}
              {mediaProperties.length === 0 && (
                <p className="database-settings-caption">
                  {t(
                    'Add a Files & media field to use a card preview.',
                    '先添加“文件和媒体”字段，即可用作卡片预览。',
                  )}
                </p>
              )}
            </>
          )}
          {section === 'visibility' && (
            <>
              <p className="database-settings-caption">
                {t(
                  'The name is always visible. Hidden properties remain in each record.',
                  '名称始终显示。隐藏字段仍保留在记录中。',
                )}
              </p>
              <div className="database-visibility-actions">
                <button
                  onClick={() => patch({ visiblePropertyIds: undefined })}
                >
                  {t('Show all', '全部显示')}
                </button>
                <button onClick={() => patch({ visiblePropertyIds: [] })}>
                  {t('Hide all', '全部隐藏')}
                </button>
              </div>
              <SettingsVisibility
                properties={database.properties}
                propertyVisibility={visible}
                toggleProperty={(id) =>
                  patch({
                    visiblePropertyIds: visible.includes(id)
                      ? visible.filter((key) => key !== id)
                      : [...visible, id],
                  })
                }
                searchLabel={t('Search properties…', '搜索字段…')}
                emptyLabel={t('No properties found.', '没有匹配的字段。')}
              />
            </>
          )}
          {section === 'sort' && (
            <DatabaseSortSettings
              database={database}
              view={view}
              patch={patch}
            />
          )}
          {section === 'filter' && (
            <DatabaseFilterSettings
              database={database}
              view={view}
              patch={patch}
            />
          )}
          {section === 'group' && (
            <>
              <p className="database-settings-caption">
                {t(
                  'Group by a select or status property.',
                  '选择单选或状态字段进行分组。',
                )}
              </p>
              {[
                { id: '', name: t('No grouping', '不分组') },
                ...database.properties.filter(isGroupProperty),
              ].map((property) => (
                <button
                  key={property.id}
                  className="database-setting-row"
                  aria-pressed={(grouping || '') === property.id}
                  onClick={() => patch({ groupBy: property.id || null })}
                >
                  <Columns3 size={16} />
                  <span>{property.name}</span>
                  {(grouping || '') === property.id && <Check size={15} />}
                </button>
              ))}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
