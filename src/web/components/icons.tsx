import type { ComponentChildren } from "preact";

function Svg({ children, label, cls = "h-4 w-4" }: { children: ComponentChildren; label?: string; cls?: string }) {
  return (
    <svg viewBox="0 0 24 24" class={cls} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
      stroke-linejoin="round" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {children}
    </svg>
  );
}

export const HandIcon = ({ label = "Espera respuesta humana" }: { label?: string }) => (
  <Svg label={label}>
    <path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8" />
    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.9-2.4L3.4 16a2 2 0 0 1 3.2-2.4L8 15" />
  </Svg>
);
export const CameraIcon = ({ label = "Tiene capturas" }: { label?: string }) => (
  <Svg label={label}>
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" />
    <circle cx="12" cy="13" r="3" />
  </Svg>
);
export const SunIcon = () => (
  <Svg><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Svg>
);
export const MoonIcon = () => (<Svg><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></Svg>);
export const MenuIcon = () => (<Svg><path d="M3 6h18M3 12h18M3 18h18" /></Svg>);
export const CloseIcon = () => (<Svg><path d="M18 6 6 18M6 6l12 12" /></Svg>);
