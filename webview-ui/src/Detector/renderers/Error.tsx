export interface ErrorProps {
    message: string;
    data: unknown;
}

export function Error(props: ErrorProps) {
    return (
        <>
            <h2>Rendering Error</h2>
            <p>{props.message}</p>
            <h3>Data</h3>
            <pre>{JSON.stringify(props.data, null, 2)}</pre>
        </>
    );
}
