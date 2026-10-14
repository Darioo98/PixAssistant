import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { resources } from '@shared/i18n'

void i18next.use(initReactI18next).init({
  resources,
  lng: 'it',
  fallbackLng: 'it',
  interpolation: { escapeValue: false }
})

export default i18next
