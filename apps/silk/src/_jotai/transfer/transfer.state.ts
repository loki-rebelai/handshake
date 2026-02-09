import { atom } from 'jotai';
import type { TransferInfo } from '@silkyway/sdk/dist/transfers.js';

export const transfersAtom = atom<TransferInfo[]>([]);

export const isLoadingTransfersAtom = atom<boolean>(false);
