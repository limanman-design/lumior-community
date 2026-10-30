import { MaterialIcon, type MaterialIconName } from './material-icon';

type IconProps = { size?: number };

function symbol(name: MaterialIconName) {
  return function DatabaseSymbol({ size = 16 }: IconProps) {
    return <MaterialIcon name={name} size={size} />;
  };
}

export function DatabaseStatusIcon({ size = 16 }: IconProps) {
  return (
    <span
      aria-hidden="true"
      className="workspace-symbol database-status-icon"
      style={{
        width: size,
        height: size,
        maskImage: "url('/assets/database/status.svg')",
      }}
    />
  );
}

export const databasePropertyIcons = {
  text: symbol('title'),
  number: symbol('numbers'),
  select: symbol('radio_button_checked'),
  multiSelect: symbol('checklist'),
  status: DatabaseStatusIcon,
  date: symbol('calendar_month'),
  checkbox: symbol('check_box'),
  createdAt: symbol('schedule'),
  updatedAt: symbol('schedule'),
  files: symbol('attach_file'),
};

export const databaseViewIcons = {
  table: symbol('view_list'),
  board: symbol('view_week'),
  list: symbol('list'),
  gallery: symbol('gallery_thumbnail'),
};
