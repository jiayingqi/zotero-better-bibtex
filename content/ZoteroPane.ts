declare const Zotero: any
declare const window: any
declare const document: any
declare const Components: any

import { log } from './logger'
import { BetterBibTeX } from './better-bibtex'
import { TeXstudio } from './tex-studio'
import { clean_pane_persist, patch as $patch$ } from './monkey-patch'
import { Preferences as Prefs } from './prefs'
import { AutoExport } from './auto-export'
import { flash } from './flash'
import { sentenceCase } from './case'
import * as CAYW from './cayw'

const pane = Zotero.getActiveZoteroPane()

$patch$(pane, 'buildCollectionContextMenu', original => async function() {
  // eslint-disable-next-line prefer-rest-params
  await original.apply(this, arguments)

  try {
    const treeRow = this.collectionsView.selectedTreeRow
    const isLibrary = treeRow && treeRow.isLibrary(true)
    const isCollection = treeRow && treeRow.isCollection()

    document.getElementById('bbt-collectionmenu-separator').hidden = !(isLibrary || isCollection)
    document.getElementById('bbt-collectionmenu-pull-url').hidden = !(isLibrary || isCollection)
    document.getElementById('bbt-collectionmenu-report-errors').hidden = !(isLibrary || isCollection)

    const tagDuplicates = document.getElementById('bbt-collectionmenu-tag-duplicates')
    if (isLibrary) {
      tagDuplicates.hidden = false
      tagDuplicates.setAttribute('libraryID', treeRow.ref.libraryID.toString())
    }
    else {
      tagDuplicates.hidden = true
    }

    let query = null
    if (Prefs.get('autoExport') === 'immediate') {
      query = null
    }
    else if (isCollection) {
      query = { type: 'collection', id: treeRow.ref.id }
    }
    else if (isLibrary) {
      query = { type: 'library', id: treeRow.ref.libraryID }
    }
    const auto_exports = query ? AutoExport.db.find(query) : []

    for (const node of [...document.getElementsByClassName('bbt-autoexport')]) {
      node.hidden = auto_exports.length === 0
    }

    if (auto_exports.length !== 0) {
      const menupopup = document.getElementById('zotero-itemmenu-BetterBibTeX-autoexport-menu')
      while (menupopup.children.length > 1) menupopup.removeChild(menupopup.firstChild)
      for (const [index, ae] of auto_exports.entries()) {
        const menuitem = (index === 0 ? menupopup.firstChild : menupopup.appendChild(menupopup.firstChild.cloneNode(true)))
        menuitem.label = ae.path
      }
    }

  }
  catch (err) {
    log.error('ZoteroPane.buildCollectionContextMenu:', err)
  }
})

// Monkey patch because of https://groups.google.com/forum/#!topic/zotero-dev/zy2fSO1b0aQ
$patch$(pane, 'serializePersist', original => function() {
  // eslint-disable-next-line prefer-rest-params
  original.apply(this, arguments)
  if (Zotero.BetterBibTeX.uninstalled) clean_pane_persist()
})

export = new class ZoteroPane {
  public constructor() {
    window.addEventListener('load', () => {
      BetterBibTeX.load(document)
        .then(() => {
          log.debug('Better BibTeX load finished successfully')
        })
        .catch(err => {
          log.error('Better BibTeX load failed', err)
        })
    }, false)
  }

  public pullExport() {
    if (!pane.collectionsView || !pane.collectionsView.selection || !pane.collectionsView.selection.count) return

    const row = pane.collectionsView.selectedTreeRow

    const root = `http://127.0.0.1:${Zotero.Prefs.get('httpServer.port')}/better-bibtex/export`
    const params = {
      url: {
        long: '',
        short: '',
      },
    }

    if (row.isCollection()) {
      let collection = pane.getSelectedCollection()
      params.url.short = `${root}/collection?/${collection.libraryID || 0}/${collection.key}`

      let path = `/${encodeURIComponent(collection.name)}`
      while (collection.parent) {
        collection = Zotero.Collections.get(collection.parent)
        path = `/${encodeURIComponent(collection.name)}/${path}`
      }
      params.url.long = `${root}/collection?/${collection.libraryID || 0}${path}`
    }

    if (row.isLibrary(true)) {
      const libId = pane.getSelectedLibraryID()
      const short = libId ? `/${libId}/library` : 'library'
      params.url.short = `${root}/library?${short}`
    }

    if (!params.url.short) return

    window.openDialog('chrome://zotero-better-bibtex/content/ServerURL.xul', '', 'chrome,dialog,centerscreen,modal', params)
  }

  public startAutoExport(event) {
    event.stopPropagation()
    const path = event.target.getAttribute('label')
    const ae = AutoExport.db.findOne({ path })

    if (ae) {
      AutoExport.run(ae.$loki)
    }
    else {
      log.error('cannot find ae for', { path })
    }
  }

  public async addCitationLinks() {
    const items = Zotero.getActiveZoteroPane().getSelectedItems()
    if (items.length !== 1) {
      flash('Citation links only works for a single reference')
      return
    }

    const extra = items[0].getField('extra') || ''
    const citations = new Set(extra.split('\n').filter((line: string) => line.startsWith('cites:')))
    const picked = (await CAYW.pick({ format: 'citationLinks' })).split('\n').filter(citation => !citations.has(citation))

    if (picked.length) {
      items[0].setField('extra', `${extra}\n${picked.join('\n')}`.trim())
      await items[0].saveTx()
    }
  }

  public async toTeXstudio() {
    await TeXstudio.push()
  }

  public errorReport(includeReferences) {
    let scope = null

    switch (pane && includeReferences) {
      case 'collection': case 'library':
        scope = { type: 'collection', collection: pane.getSelectedCollection() }
        if (!scope.collection) scope = { type: 'library', id: pane.getSelectedLibraryID() }
        break

      case 'items':
        try {
          scope = { type: 'items', items: pane.getSelectedItems() }
        }
        catch (err) { // zoteroPane.getSelectedItems() doesn't test whether there's a selection and errors out if not
          log.error('Could not get selected items:', err)
          scope = {}
        }

        if (!scope.items || !scope.items.length) scope = null
        break
    }

    const params = {wrappedJSObject: { scope }}

    const ww = Components.classes['@mozilla.org/embedcomp/window-watcher;1'].getService(Components.interfaces.nsIWindowWatcher)
    ww.openWindow(null, 'chrome://zotero-better-bibtex/content/ErrorReport.xul', 'better-bibtex-error-report', 'chrome,centerscreen,modal', params)
  }

  public async sentenceCase() {
    const items = Zotero.getActiveZoteroPane().getSelectedItems()
    for (const item of items) {
      let save = false

      const title = item.getField('title')
      let sentenceCased = sentenceCase(title)
      if (title !== sentenceCased) {
        save = true
        item.setField('title', sentenceCased)
      }

      const shortTitle = item.getField('shortTitle')
      if (sentenceCased.toLowerCase().startsWith(shortTitle.toLowerCase())) {
        sentenceCased = sentenceCased.substr(0, shortTitle.length)
        if (shortTitle !== sentenceCased) {
          item.setField('shortTitle', sentenceCased)
          save = true
        }
      }

      if (save) await item.saveTx()
    }
  }
}

// otherwise this entry point won't be reloaded: https://github.com/webpack/webpack/issues/156
delete require.cache[module.id]
