import { createHelia } from 'helia'
import { unixfs } from '@helia/unixfs'
import {SDK, create} from 'hyper-sdk'
import Torrentz from 'torrentz'
import express from 'express'
import path from 'path'
import fs from 'fs'
import { FsDatastore } from 'datastore-fs'
import { FsBlockstore } from 'blockstore-fs'
import { CID } from 'multiformats/cid'
// import bodyparser from 'body-parser'
import {filesFromPaths} from 'files-from-path'
import uniqid from 'uniqid'
import {Readable, pipelinePromise} from 'streamx'

if(!fs.existsSync(path.join(import.meta.dirname, 'hybrid'))){
    fs.mkdirSync(path.join(import.meta.dirname, 'hybrid'))
}

const defOpts = {bt: {folder: path.join(import.meta.dirname, 'hybrid', 'bt')}, ipfs: {repo: path.join(import.meta.dirname, 'hybrid', 'ipfs')}, hyper: {storage: path.join(import.meta.dirname, 'hybrid', 'hyper')}}
if(!fs.existsSync(defOpts.bt.folder)){
    fs.mkdirSync(defOpts.bt.folder)
}
if(!fs.existsSync(defOpts.ipfs.repo)){
    fs.mkdirSync(defOpts.ipfs.repo)
}
if(!fs.existsSync(defOpts.hyper.storage)){
    fs.mkdirSync(defOpts.hyper.storage)
}
async function func(bt = {}, ipfs = {}, hyper = {}){
    const torrentz = new Torrentz({...defOpts.bt, ...bt})
    const helia = await createHelia({...defOpts.ipfs, ...ipfs, blockstore: new FsBlockstore(ipfs.repo || defOpts.ipfs.repo), datastore: new FsDatastore(ipfs.repo || defOpts.ipfs.repo)})
    const holepunch = await create({...defOpts.hyper, ...hyper})
    helia.drive = unixfs(helia)
    // holepunch.disk = await holepunch.getDrive('title')
    holepunch.check = (await holepunch.getDrive('title')).key.toString('hex')

    return new Hybrid(torrentz, helia, holepunch)
}
class Hybrid {
    constructor(bt, ipfs, hyper){
        this.bt = bt
        this.ipfs = ipfs
        this.hyper = hyper
        this.app = express()
        this.app.use(express.static(path.join(import.meta.dirname, 'public')))
        this.app.use(express.urlencoded({ extended: true }))
        this.app.use(express.json())
        this.app.get('/', (req, res) => {
            return res.sendFile(path.join(__dirname, 'public', 'index.html'))
        })
        this.app.get('*', (req, res) => {return res.status(200).json('success')})
        this.app.post('/', async (req, res) => {
            try {
                console.log(res.body)
                if(req.body.proto === 'bt'){
                    if(req.body.verb === 'head'){
                        return res.status(200).json('')
                    } else if(req.body.verb === 'get'){
                        return res.status(200).json(await this.bt.loadTorrent(req.body.id, req.body.path, {}))
                    } else if(req.body.verb === 'post'){
                        return res.status(200).json(await this.bt.publishTorrent(req.body.id || req.body.address, req.body.path, filesFromPaths(req.body.data), {extra: req.body.extra}))
                    } else if(req.body.verb === 'delete'){
                        return res.status(200).json(await this.bt.shredTorrent(req.body.id, req.body.path, {}))
                    } else {
                        return res.status(400).json('unsuccessful')
                    }
                } else if(req.body.proto === 'ipfs'){
                    if(req.body.verb === 'head'){
                        return res.status(200).json('')
                    } else if(req.body.verb === 'get'){
                        let test
                        for await (const buf of this.ipfs.drive.cat(CID.parse(req.body.id), {path: req.body.path})) {
                            test = buf
                        }
                        return res.status(200).json(test)
                    } else if(req.body.verb === 'post'){
                        // const useHostPath = req.body.id ? path.join('/', req.body.id, req.body.path) : path.join('/', uniqid(), req.body.path)
                        if(!req.body.id && !req.body.path){
                            req.body.id = uniqid()
                        }
                        let test
                        const src = filesFromPaths(req.body.data).map((datas) => {return {path: path.join('/', req.body.id, req.body.path, datas.webkitRelativePath || datas.name), content: Readable.from(datas.stream())}})
                        for await (const testing of this.ipfs.drive.addAll(src, useOpts)){
                          test = testing.cid
                        }
                        return res.status(200).json(test)
                    } else if(req.body.verb === 'delete'){
                        return res.status(200).json(await this.ipfs.drive.rm(CID.parse(req.body.id), req.body.path.slice(1), {}))
                    } else {
                        return res.status(400).json('unsuccessful')
                    }
                } else if(req.body.proto === 'hyper'){
                    if(req.body.verb === 'head'){
                        return res.status(200).set('X-ID', this.holepunch.check).json('')
                    } else if(req.body.verb === 'get'){
                        const fileOrFolder = path.extname(req.body.path)
                        const useDrive = req.body.id === holepunch.check ? await this.holepunch.getDrive('title') : await this.holepunch.getDrive(req.body.id)
                        let test
                        if(fileOrFolder){
                            test = await useDrive.get(req.body.path, {})
                        } else {
                            test = []
                            for await (const tests of useDrive.readdir(req.body.path)) {
                                test.push(tests)
                            }
                        }
                        return res.status(200).json(test)
                    } else if(req.body.verb === 'post'){
                        const useDrive = req.body.id === holepunch.check ? await this.holepunch.getDrive('title') : await this.holepunch.getDrive(req.body.id)
                        const test = []
                        for (const info of fileOrFolder(req.body.data)) {
                          const str = path.join(req.body.path, info.webkitRelativePath || info.name).replace(/\\/g, "/")
                          await pipelinePromise(Readable.from(info.stream()), useDrive.createWriteStream(str, {}))
                          test.push(str)
                        }
                        return res.status(200).json(test)
                    } else if(req.body.verb === 'delete'){
                        const useDrive = req.body.id === holepunch.check ? await this.holepunch.getDrive('title') : await this.holepunch.getDrive(req.body.id)
                        let test
                        if (path.extname(req.body.path)) {
                            await useDrive.del(req.body.path)
                            test = req.body.path
                          } else {
                            test = []
                            for await (const tests of useDrive.list(req.body.path)){
                                await useDrive.del(tests.key)
                                test.push(tests.key)
                            }
                          }
                        return res.status(200).json(test)
                    } else {
                        return res.status(400).json('unsuccessful')
                    }
                } else {
                    return res.status(400).json('unsuccessful')
                }
            } catch {
                return res.status(500).json('unsuccessful')
            }
        })
        this.app.delete('*', (req, res) => {return res.status(200).json('success')})
        // this.app.listen(13579, () => {
        //     console.log('listening')
        // })
    }
}

func().then((hybrid) => {
    hybrid.app.listen(13579, () => {
        console.log('listening')
    })
    process.on('SIGINT', async function() {
        console.log("Caught interrupt signal")
        hybrid.bt.destroy()
        await hybrid.ipfs.stop()
        hybrid.hyper.close()
        process.exit()
    })
}).catch(console.error)