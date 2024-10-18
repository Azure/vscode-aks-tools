import { SvgProps } from "./svgProps";

export function ArrowIcon(props: SvgProps) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M7.97612 10.0719L12.3334 5.71461L12.9521 6.33333L8.28548 11L7.66676 11L3.0001 6.33333L3.61882 5.71461L7.97612 10.0719Z"
                className={props.className}
            />
        </svg>
    );
}
