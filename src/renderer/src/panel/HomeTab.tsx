import { useTranslation } from 'react-i18next'

export function HomeTab() {
  const { t } = useTranslation()
  return (
    <div className="placeholder">
      <h2>{t('home.greeting')}</h2>
      <p>{t('home.intro')}</p>
    </div>
  )
}
