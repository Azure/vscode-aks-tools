import { InitialState } from "../../../src/webview-contract/webviewDefinitions/kaitoTest";
import { vscode, stateUpdater } from "./state";
import { useStateManagement } from "../utilities/state";
import { VSCodeDivider } from "@vscode/webview-ui-toolkit/react";
import { useState } from "react";
import styles from "./KaitoTest.module.css";

export function KaitoTest(initialState: InitialState) {
    const { state } = useStateManagement(stateUpdater, initialState, vscode);
    const [formData, setFormData] = useState({
        prompt: "",
        temperature: 0.5,
        topP: 0.5,
        topK: 50,
        repetitionPenalty: 1.5,
        maxLength: 250,
    });

    const [activeSlider, setActiveSlider] = useState<{ name: string; value: number | string } | null>(null);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData({
            ...formData,
            [name]: name === "prompt" ? value : parseFloat(value),
        });
        setActiveSlider({ name, value: name === "prompt" ? value : parseFloat(value) });
    };

    const handleSubmit = () => {
        vscode.postQueryRequest(formData);
    };

    const resetParams = () => {
        setFormData({
            prompt: formData.prompt,
            temperature: 0.5,
            topP: 0.5,
            topK: 50,
            repetitionPenalty: 1.5,
            maxLength: 250,
        });
    };

    return (
        <div className={styles.main}>
            <h2>
                Test: {state.modelName} ({state.clusterName})
            </h2>
            <p className={styles.blurb}>
                Experiment with AI outputs by fine-tuning parameters. Discover how each adjustment influences the
                model&apos;s response.
            </p>
            <VSCodeDivider />
            <div className={styles.mainGrid}>
                <div className={styles.formDiv}>
                    <div className={styles.formDivGrid}>
                        <label>Prompt</label>
                        <textarea
                            name="prompt"
                            value={formData.prompt}
                            onChange={handleInputChange}
                            placeholder="Enter prompt here..."
                            rows={5}
                            maxLength={500}
                            wrap="soft"
                            style={{ overflow: "hidden", whiteSpace: "pre-wrap" }}
                        />
                        <span></span>
                        <span className={styles.submitSpan}>
                            <button className={styles.resetButton} onClick={resetParams}>
                                Reset Params
                            </button>
                            <button className={styles.mainButton} onClick={handleSubmit}>
                                Submit Prompt
                            </button>
                        </span>
                        <label>Temperature</label>
                        <div className={styles.sliderContainer}>
                            <span className={styles.min}>0.01</span>
                            <input
                                type="range"
                                min="0.01"
                                max="1.00"
                                step="0.01"
                                name="temperature"
                                value={formData.temperature}
                                onChange={handleInputChange}
                            />
                            {activeSlider?.name === "temperature" && (
                                <div className={styles.tooltip}>{activeSlider.value}</div>
                            )}
                            <span className={styles.max}>1.00</span>
                        </div>

                        <label>Top P</label>
                        <div className={styles.sliderContainer}>
                            <span className={styles.min}>0.01</span>

                            <input
                                type="range"
                                min="0.01"
                                max="1.00"
                                step="0.01"
                                name="topP"
                                value={formData.topP}
                                onChange={handleInputChange}
                            />
                            {activeSlider?.name === "topP" && (
                                <div className={styles.tooltip}>{activeSlider.value}</div>
                            )}
                            <span className={styles.max}>1.00</span>
                        </div>

                        <label>Top K</label>
                        <div className={styles.sliderContainer}>
                            <span className={styles.min}>1</span>

                            <input
                                type="range"
                                min="1"
                                max="100"
                                step="1"
                                name="topK"
                                value={formData.topK}
                                onChange={handleInputChange}
                            />
                            {activeSlider?.name === "topK" && (
                                <div className={styles.tooltip}>{activeSlider.value}</div>
                            )}
                            <span className={styles.max}>100</span>
                        </div>

                        <label>Repetition Penalty</label>
                        <div className={styles.sliderContainer}>
                            <span className={styles.min}>1.00</span>

                            <input
                                type="range"
                                min="1.00"
                                max="2.00"
                                step="0.01"
                                name="repetitionPenalty"
                                value={formData.repetitionPenalty}
                                onChange={handleInputChange}
                            />
                            {activeSlider?.name === "repetitionPenalty" && (
                                <div className={styles.tooltip}>{activeSlider.value}</div>
                            )}
                            <span className={styles.max}>2.00</span>
                        </div>

                        <label>Max Length</label>
                        <div className={styles.sliderContainer}>
                            <span className={styles.min}>0</span>

                            <input
                                type="range"
                                min="0"
                                max="500"
                                step="10"
                                name="maxLength"
                                value={formData.maxLength}
                                onChange={handleInputChange}
                            />
                            {activeSlider?.name === "maxLength" && (
                                <div className={styles.tooltip}>{activeSlider.value}</div>
                            )}
                            <span className={styles.max}>500</span>
                        </div>
                    </div>
                </div>
                {state.output !== "" && (
                    <div className={styles.outputDiv}>
                        <p className={styles.outputHeader}>Output</p>
                        <VSCodeDivider className={styles.endDivider} />
                        <p className={styles.output}>{state.output}</p>
                    </div>
                )}
            </div>
        </div>
    );
}
