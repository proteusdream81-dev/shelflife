import { getAccessToken } from '@base44/sdk';

const isNode = typeof window === 'undefined';

// Some browsers and webviews refuse storage access outright and throw a SecurityError the
// moment it is touched. A refused read only ever means "there is no saved token", never a
// reason to stop the app from starting, so each access is contained here.
const storedToken = () => {
	try {
		return getAccessToken() || null;
	} catch {
		return null;
	}
};

const clearStoredAccessToken = () => {
	try {
		window.localStorage.removeItem('base44_access_token');
		window.localStorage.removeItem('token');
	} catch {
		// Storage is unavailable, so there is nothing stored to clear.
	}
}

const isClearAccessTokenRequested = () => {
	if (isNode) return false;

	try {
		return new URLSearchParams(window.location.search).get("clear_access_token") === 'true';
	} catch {
		return false;
	}
};

const getAppParams = () => {
	if (isClearAccessTokenRequested()) {
		clearStoredAccessToken();
	}
	return {
		appId: import.meta.env.VITE_BASE44_APP_ID,
		token: storedToken(),
		functionsVersion: import.meta.env.VITE_BASE44_FUNCTIONS_VERSION,
		appBaseUrl: import.meta.env.VITE_BASE44_APP_BASE_URL,
	}
}


export const appParams = {
	...getAppParams()
}