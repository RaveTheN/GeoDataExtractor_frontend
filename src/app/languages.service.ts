import { Injectable } from "@angular/core";

@Injectable({
  providedIn: "root",
})
export class LanguagesService {
  currentLanguage: string = "en";

  constructor() {}
}
