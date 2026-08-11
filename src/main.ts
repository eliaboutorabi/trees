import { mount } from 'svelte';
import App from './app/App.svelte';
import './app/app.css';

const target = document.getElementById('app');
if (!target) throw new Error('missing #app mount point');

export default mount(App, { target });
