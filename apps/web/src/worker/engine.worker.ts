// The engine Web Worker: analysis, retractions and the solver run here, off the main thread.
import { expose } from 'comlink';
import { engineApi } from './api';

expose(engineApi);
