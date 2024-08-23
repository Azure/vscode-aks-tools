import { ModelDetails } from "../../../src/webview-contract/webviewDefinitions/kaito";

export type KaitoFamilyModelInputProps = {
    modelDetails: ModelDetails[];
};

export function KaitoFamilyModelInput(props: KaitoFamilyModelInputProps) {
    return (
        <div>
            {props.modelDetails.map((model, index) => (
                <div key={index}>
                    <label>{model.family}</label>
                    <label>{model.modelName}</label>
                    <label>{model.minimumGpu}</label>
                    <label>{model.kaitoVersion}</label>
                    <label>{model.modelSource}</label>
                </div>
            ))}
        </div>
    );
}
