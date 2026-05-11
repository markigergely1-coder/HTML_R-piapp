import './style.css';
import { startRouter } from './router';

const app = document.querySelector<HTMLDivElement>('#app')!;
startRouter(app);
