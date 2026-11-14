import React, { Component, Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import StorageUnavailable from '@/components/StorageUnavailable'
import '@/index.css'
import '@/styles/velvet-plum-a.css'
import '@/styles/velvet-plum-b.css'

// Keep the Firebase auth diagnostic outside the legacy Base44 application tree.
const FirebaseAuthPreview = lazy(() => import('@/pages/FirebaseAuthPreview'))
const FirebaseModerationPreview = lazy(() => import('@/pages/FirebaseModerationPreview'))
const App = lazy(() => import('@/App.jsx'))
const isFirebaseAuthPreview = window.location.pathname === '/firebase-auth-preview'
const isFirebaseModerationPreview = window.location.pathname === '/firebase-moderation-preview'

class PreviewErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    console.error('Firebase auth preview failed to render:', error)
    window.__SHELFLIFE_PREVIEW_DEBUG__?.report('React error boundary caught a render error', error)
  }

  render() {
    if (this.state.error) {
      return (
        <main className="min-h-screen flex items-center justify-center bg-background px-6 text-foreground">
          <section className="vp-panel max-w-md p-6">
            <h1 className="text-xl font-semibold">Firebase preview could not load</h1>
            <p className="mt-3 text-sm text-muted-foreground">The isolated preview hit a page-rendering error. Your existing ShelfLife sign-in and data have not been changed.</p>
            <pre className="mt-3 whitespace-pre-wrap break-words text-xs text-destructive">{this.state.error?.message || String(this.state.error)}</pre>
            <button className="vp-btn vp-primary mt-5" onClick={() => window.location.reload()}>Try again</button>
          </section>
        </main>
      )
    }
    return this.props.children
  }
}

// The SDK reads browser storage during initialization, so check access before loading it.
const storageAvailable = () => {
  try {
    window.localStorage.getItem('base44_access_token')
    return true
  } catch {
    return false
  }
}

const root = ReactDOM.createRoot(document.getElementById('root'))
window.__SHELFLIFE_PREVIEW_DEBUG__?.mark('main.jsx executed; React root created')

if (isFirebaseAuthPreview || isFirebaseModerationPreview) {
  window.__SHELFLIFE_PREVIEW_DEBUG__?.mark('Firebase auth route matched; starting isolated React render')
  root.render(
    <PreviewErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<main className="min-h-screen flex items-center justify-center bg-background text-foreground"><p role="status">Loading Firebase sign-in preview…</p></main>}>
          {isFirebaseAuthPreview ? <FirebaseAuthPreview /> : <FirebaseModerationPreview />}
        </Suspense>
      </BrowserRouter>
    </PreviewErrorBoundary>
  )
} else {
  root.render(
    storageAvailable() ? <Suspense fallback={null}><App /></Suspense> : <StorageUnavailable />
  )
}
