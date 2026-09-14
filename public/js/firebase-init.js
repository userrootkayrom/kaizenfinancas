import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"; 

const firebaseConfig = {
    apiKey: "AIzaSyA-kpoCpQLgZYBPKs9Ji9z5X-y0ccuNwKs",
    authDomain: "controle-gastos-d0fdc.firebaseapp.com",
    projectId: "controle-gastos-d0fdc",
    storageBucket: "controle-gastos-d0fdc.firebasestorage.app",
    messagingSenderId: "516751476968",
    appId: "1:516751476968:web:0813666d696da652dae15d",
    measurementId: "G-BB55YVCHP2"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Habilita persistência Offline do Firestore
enableIndexedDbPersistence(db).catch((err) => {
    if (err.code == 'failed-precondition') {
        console.warn('Múltiplas abas abertas, persistência offline falhou.');
    } else if (err.code == 'unimplemented') {
        console.warn('Navegador não suporta persistência offline.');
    }
});

// Registra Service Worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(reg => {
        console.log('Service Worker Registrado!', reg);
    }).catch(err => console.error('Erro no Service Worker', err));
}

export { db, auth };