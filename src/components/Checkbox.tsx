import { Show } from "solid-js";
import { Icon } from "./Icon";

export interface CheckboxProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  title?: string;
  size?: number;
}

export function Checkbox(props: CheckboxProps) {
  const iconSize = () => Math.round((props.size ?? 16) * 0.75);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={props.checked}
      data-checked={props.checked}
      class="checkbox"
      style={props.size ? { width: `${props.size}px`, height: `${props.size}px` } : undefined}
      title={props.title}
      onClick={(e) => {
        e.stopPropagation();
        props.onChange(!props.checked);
      }}
    >
      <Show when={props.checked}>
        <Icon name="check" size={iconSize()} stroke={2.5} />
      </Show>
    </button>
  );
}
