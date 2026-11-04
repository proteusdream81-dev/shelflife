import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import StorageUnavailable from '@/components/StorageUnavailable'
import '@/index.css'

// The SDK reads browser storage during initialization, so check access before loading it.
const storageAvailable = () => {
  try {
    window.localStorage.getItem('base44_access_token')
    return true
  } catch {
    return false
  }
}

const App = lazy(() => import('@/App.jsx'))

ReactDOM.createRoot(document.getElementById('root')).render(
  storageAvailable() ? <Suspense fallback={null}><App /></Suspense> : <StorageUnavailable />
)