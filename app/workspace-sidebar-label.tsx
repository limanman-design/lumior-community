import './workspace-sidebar-label.css';

const latinLabel = /^[\p{Script=Latin}\p{Number}\p{Punctuation}\p{Separator}\p{Mark}]+$/u;

/** Keep text clipping separate from the font metrics used to center its ink. */
export function WorkspaceSidebarLabel({ children, className = '' }: {
  children: string;
  className?: string;
}) {
  return (
    <span className={`workspace-sidebar-label ${className}`}>
      <span
        className="workspace-sidebar-label-text"
        data-text-edge={latinLabel.test(children) ? 'cap' : 'text'}
      >
        {children}
      </span>
    </span>
  );
}
