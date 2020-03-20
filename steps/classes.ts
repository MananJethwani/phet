import * as fs from 'fs';
import {LanguageItemPair, Simulation} from './types';

export class Base64Entity {
  public data: string;
  public mimeType: string;

  constructor(encoded) {
    const decoded = encoded.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    this.mimeType = decoded && decoded[1];
    this.data = decoded && decoded[2];
  }

  isEmpty(): boolean {
    return !this.data || this.data.length === 0 || !this.mimeType;
  }

  isImage(): boolean {
    return this.mimeType.split('/')[0] === 'image';
  }
}


export class SimulationsList {
  public items: LanguageItemPair<Simulation>[] = [];

  add(lang: string, item: Simulation): void {
    if (!this.items[lang]) this.items[lang] = [];
    this.items[lang].push(item);
  }

  async persist(file): Promise<void> {
    // todo sort

    try {
      await fs.promises.writeFile(file, JSON.stringify(this.items), 'utf8');
      console.log('Saved Catalog');
    } catch (e) {
      console.error(`Failed to save the catalog`);
    }
  }
}
