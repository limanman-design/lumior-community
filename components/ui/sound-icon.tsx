import './sound-icon.css';

type SoundIconName = 'queue_music' | 'more_horiz' | 'close' | 'play_arrow' | 'pause'
  | 'skip_previous' | 'skip_next' | 'volume_up' | 'volume_off'
  | 'keyboard_arrow_down' | 'progress_activity' | 'radio' | 'chevron_right' | 'tune';

// Local Google Material Symbols Rounded assets: 20px, weight 400.
export function SoundIcon({ name, className = '' }: { name: SoundIconName; className?: string }) {
  return <span aria-hidden="true" className={`sound-symbol ${className}`} style={{ maskImage: `url('/assets/sound/${name}.svg')` }}/>;
}
