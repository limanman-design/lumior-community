import './workspace-menu.css';

export type MaterialIconName =
  | 'apps'
  | 'widgets'
  | 'settings'
  | 'delete'
  | 'orbit'
  | 'search'
  | 'dashboard'
  | 'database'
  | 'backup'
  | 'close'
  | 'remove'
  | 'crop_square'
  | 'filter_none'
  | 'flashlight'
  | 'title'
  | 'text_fields'
  | 'table_chart_view'
  | 'view_list'
  | 'view_week'
  | 'list'
  | 'gallery_thumbnail'
  | 'filter_list'
  | 'sort'
  | 'tune'
  | 'straight'
  | 'keyboard_arrow_down'
  | 'calendar_month'
  | 'schedule'
  | 'numbers'
  | 'radio_button_checked'
  | 'checklist'
  | 'check_box'
  | 'attach_file'
  | 'search_outlined'
  | 'add'
  | 'pinboard'
  | 'library_add'
  | 'atlas'
  | 'progress_activity'
  | 'history'
  | 'content_copy'
  | 'thumb_up'
  | 'thumb_down'
  | 'refresh'
  | 'keyboard_arrow_up'
  | 'chevron_right'
  | 'check'
  | 'undo'
  | 'home_storage'
  | 'hub';

const outlinedSymbols = new Set<MaterialIconName>([
  'table_chart_view',
  'view_list',
  'view_week',
  'list',
  'gallery_thumbnail',
  'filter_list',
  'sort',
  'tune',
  'straight',
  'keyboard_arrow_down',
  'calendar_month',
  'schedule',
  'numbers',
  'radio_button_checked',
  'checklist',
  'check_box',
  'attach_file',
  'add',
  'library_add',
  'pinboard',
  'progress_activity',
  'history',
  'content_copy',
  'thumb_up',
  'thumb_down',
  'refresh',
  'keyboard_arrow_up',
  'chevron_right',
  'check',
  'undo',
  'home_storage',
  'hub',
]);

// Local Google Material Symbols, 20px optical size, weight 400.
export function MaterialIcon({
  name,
  size,
  filled = false,
}: {
  name: MaterialIconName;
  size?: number;
  filled?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className="workspace-symbol"
      style={{
        width: size,
        height: size,
        maskImage: `url('/assets/material-symbols/${name === 'hub' && filled ? 'hub-filled.svg' : outlinedSymbols.has(name) ? `${name.replaceAll('_', '-')}-outlined.svg` : name === 'search_outlined' ? 'search-outlined.svg' : name === 'flashlight' ? 'flashlight-on-outlined.svg' : name === 'atlas' ? 'auto-awesome-outlined.svg' : name === 'text_fields' ? 'text-fields-outlined.svg' : name === 'title' ? 'title-outlined.svg' : `${name}-rounded.svg`}')`,
      }}
    />
  );
}
