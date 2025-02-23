interface SuccessProps {
    portalClusterUrl: string;
    name: string;
}

export function Success(props: SuccessProps) {
    return (
        <>
            <h3>Cluster {props.name} was created successfully</h3>
            <p>
                Click <a href={props.portalClusterUrl}>here</a> to view your cluster in the Azure Portal.
            </p>
        </>
    );
}
