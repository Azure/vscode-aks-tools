import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleCheck, faCircleXmark, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { SingleDataset } from '../../../../src/webview-contract/webviewDefinitions/detector';
import { Error } from "./Error";
import { Status, getStatusForInsightDataset, isInsightResult } from '../utils';
import styles from "../Detector.module.css";
import { getMarkdownComponents } from './common';

const markdownComponents = getMarkdownComponents();

export function InsightsRenderer(props: SingleDataset) {
    const statusResult = getStatusForInsightDataset(props);
    if (!isInsightResult(statusResult)) {
        return Error({ message: statusResult.error, data: statusResult.data });
    }

    const status = statusResult.status;
    const icon =
        status === Status.Success ? <FontAwesomeIcon className={styles.successIndicator} icon={faCircleCheck} /> :
        status === Status.Warning ? <FontAwesomeIcon className={styles.warningIndicator} icon={faTriangleExclamation} /> :
        <FontAwesomeIcon className={styles.errorIndicator} icon={faCircleXmark} />;

    return (
    <>
        <h4>{icon}&nbsp;&nbsp;{statusResult.message}</h4>
        {hasExtraData(props) && (<table className={styles.insightTable}>
            <tbody>
            {props.table.rows.map((row, index) => (
                <tr key={index} className={styles.insightTableRow}>
                    <td className={`${styles.insightTableCell} ${styles.insightTableKey}`}>
                        <b>{row[2]}</b>
                    </td>
                    <td className={styles.insightTableCell}>
                        <ReactMarkdown rehypePlugins={[rehypeRaw]} children={getMarkdownContent(row[3])} components={markdownComponents} />
                    </td>
                </tr>
            ))}
            </tbody>
        </table>)}
    </>
    );
}

function hasExtraData(dataset: SingleDataset) {
    return dataset.table.rows.filter(r => r[2] || r[3]).length > 0;
}

function getMarkdownContent(text: string) {
    return text.replace(/^\s*<markdown>/, '').replace(/<\/markdown>\s*$/, '');
}