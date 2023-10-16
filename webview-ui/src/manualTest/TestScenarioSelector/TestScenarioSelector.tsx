import { useState } from "react";
import styles from "./TestScenarioSelector.module.css"
import { Scenario } from "../../utilities/manualTest";

export interface TestScenarioSelectorProps {
    scenarios: Scenario[]
}

export function TestScenarioSelector(props: TestScenarioSelectorProps) {
    const [selected, setSelected] = useState("");
    const [key, setKey] = useState(0);

    function handleTestScenarioChange(name: string) {
        setSelected(name);
        setKey(key + 1);
    }

    function getLinkClassNames(name: string): string {
        return [styles.contentLink, selected === name && styles.selected].filter(s => s).join(' ');
    }

    function getContent() {
        if (!selected) {
            return <></>;
        }

        const scenario = props.scenarios.find(f => f.name === selected);
        if (!scenario) {
            return <p className={styles.main}>{`Test scenario '${selected}' not found.`}</p>;
        }

        return scenario.factory();
    }

    return (
        <>
            <ul className={styles.sidebar}>
                {
                    props.scenarios.map(s => (
                        <li key={s.name}>
                            <a href="#" className={getLinkClassNames(s.name)} onClick={() => handleTestScenarioChange(s.name)}>{s.name}</a>
                        </li>
                    ))
                }
            </ul>
            {/* Use an incrementing `key` value to ensure previous content and its associated state is destroyed on each change */}
            <div className={styles.main} key={key}>{getContent()}</div>
        </>
    );
}