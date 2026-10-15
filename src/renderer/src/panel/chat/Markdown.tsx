import { memo, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTranslation } from 'react-i18next'

/**
 * Markdown delle risposte. react-markdown non interpreta HTML grezzo (niente
 * script o tag pericolosi); i link non si aprono dentro Pix.
 */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          a: ({ children, href }) => (
            <span className="md-link" title={href}>
              {children}
            </span>
          ),
          img: ({ alt }) => <span className="md-link">[{alt}]</span>
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node && typeof node === 'object' && 'props' in node) return textOf((node as { props: { children?: ReactNode } }).props.children)
  return ''
}

function CodeBlock({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  return (
    <div className="code-block">
      <button
        className="code-copy"
        onClick={() =>
          void window.pix.chat.apply({ op: 'copy', text: textOf(children).replace(/\n$/, '') }).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
          })
        }
      >
        {copied ? t('ai.chat.copied') : t('ai.chat.copy')}
      </button>
      <pre>{children}</pre>
    </div>
  )
}
