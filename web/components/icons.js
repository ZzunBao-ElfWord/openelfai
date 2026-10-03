/* 图标（内联 SVG，语义约定类符号，与原版一致） */
export function Icon({ name, size = 18, className }) {
  const paths = {
    chat: <path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.55L4 20.5l1.5-4.35A8.5 8.5 0 1 1 21 11.5z" />,
    image: (
      <g>
        <rect x="3" y="4" width="18" height="16" rx="2.5" />
        <circle cx="8.6" cy="9.4" r="1.6" />
        <path d="M3.5 17.5l4.8-4.8 3.2 3.2 3.4-3.4 5.6 5.6" />
      </g>
    ),
    media: <path d="M4 10.5v3M8 7.5v9M12 4.5v15M16 7.5v9M20 10.5v3" />,
    code: <path d="M8.5 6.5 3.5 12l5 5.5M15.5 6.5l5 5.5-5 5.5" />,
    office: (
      <g>
        <path d="M6 3.5h8l4.5 4.5v12.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1z" />
        <path d="M14 3.5V8h4.5" />
        <path d="M8.5 13h7M8.5 16.5h5" />
      </g>
    ),
    agent: (
      <g>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M15.6 8.4l-1.9 5.3-5.3 1.9 1.9-5.3z" />
      </g>
    ),
    search: (
      <g>
        <circle cx="11" cy="11" r="6.5" />
        <path d="M20 20l-4.4-4.4" />
      </g>
    ),
    searchOff: (
      <g>
        <circle cx="11" cy="11" r="6.5" />
        <path d="M20 20l-4.4-4.4" />
        <path d="M8.6 8.6l4.8 4.8M13.4 8.6l-4.8 4.8" />
      </g>
    ),
    download: (
      <g>
        <path d="M12 4v10.5" />
        <path d="m7.5 11 4.5 4.5L16.5 11" />
        <path d="M5 19.5h14" />
      </g>
    ),
    external: (
      <g>
        <path d="M14 5h5v5" />
        <path d="M19.5 4.5 11 13" />
        <path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
      </g>
    ),
    arrowLeft: (
      <g>
        <path d="M19 12H5" />
        <path d="m11 18-6-6 6-6" />
      </g>
    ),
    arrowRight: <path d="M5 12h14m-6-6 6 6-6 6" />,
    star4: (
      <path
        d="M12 1.8l2.7 7.5 7.5 2.7-7.5 2.7-2.7 7.5-2.7-7.5-7.5-2.7 7.5-2.7z"
        fill="currentColor"
        stroke="none"
      />
    ),
    sliders: (
      <g>
        <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
        <circle cx="15" cy="7" r="2" />
        <circle cx="9" cy="17" r="2" />
      </g>
    ),
    close: (
      <g>
        <path d="M6 6l12 12M18 6 6 18" />
      </g>
    )
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {paths[name] || null}
    </svg>
  );
}
