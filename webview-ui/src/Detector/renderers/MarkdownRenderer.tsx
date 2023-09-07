import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import { SingleDataset } from '../../../../src/webview-contract/webviewDefinitions/detector';
import { getMarkdownComponents } from './common';

const markdownComponents = getMarkdownComponents();

export function MarkdownRenderer(props: SingleDataset) {
    return (
    <>
        <h4>{props.renderingProperties.title}</h4>
        {props.table.rows.map((r, i) => (
            <ReactMarkdown key={i} rehypePlugins={[rehypeRaw]} children={r[0]} components={markdownComponents} />
        ))}
    </>
    );
}