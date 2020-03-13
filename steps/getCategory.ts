import * as fs from 'fs';
import * as request from 'request-promise-native'; // deprecated
import * as requestAsync from 'request'; // deprecated
import * as cheerio from 'cheerio';
import * as async from 'async';
import asyncPool from "tiny-async-pool";
import slugify from 'slugify';
import axios from 'axios';

import { Simulation, SimulationWithoutAdditional } from './types';
import * as config from '../config';


const inDir = '';
const outDir = 'state/get/';


const log = function (...args: any[]) { config.verbose && console.log.apply(console, arguments) };
const error = function (...args: any[]) { config.verbose && console.error.apply(console, arguments) };


// todo move to class
const categoriesTree = {};
const fetchCategoriesTree = async () => {
    await asyncPool(
        2,  // TODO adjust this to avoid 503's
        config.categoriesToGet,
        async (categoryTitle) => {
            let url = `https://phet.colorado.edu/en/simulations/category/${slugify(categoryTitle, {lower: true})}/index`;
            const response = await axios.get(url);
            const $ = cheerio.load(response.data);
            const categoryElements = $('.simulation-index a').toArray();
            if (categoryElements.length === 0) {
                console.warn('Failed to get categoryElements');
            }
            categoryElements.map((item) => {
                const slug = $(item).attr('href').split('/').pop();
                if (!categoriesTree[slug]) {
                    categoriesTree[slug] = [categoryTitle];
                } else {
                    categoriesTree[slug].push(categoryTitle);
                }
            });
        }
    );
};

// todo move to class
const getItemCategories = async (item) => {
    // lazy fetch categories tree
    if (!Object.keys(categoriesTree).length) {
        await fetchCategoriesTree();
        console.log(`Got categories tree`);
    }
    return categoriesTree[item] || [];
};

console.log(`Starting build with [${config.languagesToGet.length}] languages`);
async.mapLimit(
    config.languagesToGet.map(lang => [lang, `https://phet.colorado.edu/${lang}/offline-access`]),
    config.workers,
    function ([lang, url], next) {
        request.get(url)
            .catch(err => next(err, null))
            .then(html => next(null, { lang, html }));
    },
    function (err, pages: any[]) {
        const sims = pages.reduce<SimulationWithoutAdditional[]>((acc: SimulationWithoutAdditional[], { lang, html }) => {
            const $ = cheerio.load(html);
            const sims = $('.oa-html5 > a').toArray().map(function (item) {
                return $(item).attr('href').split('/').pop().split('.')[0].split('_');
            })
                .filter(([id, language]) => language === lang)
                .map(([id, language]) => {
                    return { id, language };
                });
            return acc.concat(sims);
        }, []);

        let catalog = [];

        console.log(`Got list of ${sims.length} simulations to fetch... Here we go!`);
        async.mapLimit(sims, config.workers, function (sim, next) {
            request.get(`https://phet.colorado.edu/${sim.language}/simulation/${sim.id}`)
                .then(async html => {
                    console.log(`Got ${sim.language} ${sim.id} metadata`);
                    const $ = cheerio.load(html);
                    const [id, language] = $('.sim-download').attr('href').split('/').pop().split('.')[0].split('_');
                    catalog.push(<Simulation>{
                        categories: await getItemCategories(sim.id),
                        id,
                        language,
                        title: $('.simulation-main-title').text().trim(),
                        // difficulty: categories.filter(c => c[0].title === 'By Grade Level').map(c => c[1].title),    // TODO
                        topics: $('.sim-page-content ul').first().text().split('\n').map(t => t.trim()).filter(a => a),
                        description: $('.simulation-panel-indent[itemprop]').text()
                    });
                    next(null, null);
                })
                .catch(err => {
                    console.error(`Got a 404 for ${sim.language} ${sim.id}`);
                    next(null, null);
                });
        }, function (err, pages) {
            console.log(`Got ${pages.length} pages`);

            fs.writeFileSync(`${outDir}catalog.json`, JSON.stringify(catalog), 'utf8');

            console.log('Saved Catalog');

            const simUrls = catalog.map(sim => `https://phet.colorado.edu/sims/html/${sim.id}/latest/${sim.id}_${sim.language}.html`);
            const imgUrls = simUrls.map(url => url.split('_')[0]).sort().filter((url, index, arr) => url != arr[index - 1]).map(url => url + `-${config.imageResolution}.png`);

            const urlsToGet = simUrls.concat(imgUrls);
            console.log(`Getting ${simUrls} simulations`);
            async.eachLimit(urlsToGet, config.workers, function (url, next) {
                const req = requestAsync(url);
                let fileName = url.split('/').pop();
                if (fileName.slice(-4) === '.png') {
                    const fileParts = fileName.split('-');
                    fileName = fileParts.slice(0, -1).join('-') + '.png';
                }
                const writeStream = fs.createWriteStream(outDir + fileName);

                req.on('response', function (response) {
                    if (response.statusCode !== 200) {
                        error(`${fileName} gave a ${response.statusCode}`);

                        fs.unlink(outDir + fileName, function (err) {
                            if (err) error(`Failed to delete item: ${err}`);
                        });
                    }
                }).pipe(writeStream);

                writeStream.on('close', _ => {
                    console.log(`Got ${url}`);
                    next(null, null);
                });
            }, function (err, done) {
                console.log('Got the stuff!'); //TODO: Better logs
            })
        });
    });



/*
const majorCategories = ['physics', 'biology', 'chemistry', 'earth-science', 'math', 'by-level'];

Promise.all( //Get all possible categories
    majorCategories.map(majorCategory => {
        return new Promise((resolve, reject) => {
            request.get(`https://phet.colorado.edu/en/simulations/category/${majorCategory}`)
                .then((html) => {
                    const $ = cheerio.load(html);
                    const cat = $('.nml-link-label.selected').last().parent();
                    const categories: Category[] = cat.next().find('a').toArray()
                        .map(el => {
                            return [{
                                title: cat.text().trim(),
                                slug: cat.attr('href').split('/').slice(-1)[0]
                            }, {
                                title: $(el).text().trim(),
                                slug: $(el).attr('href').split('/').slice(-1)[0]
                            }];
                        });
                    if (cat.text().trim() !== 'By Grade Level') {
                        categories.push([{
                            title: cat.text().trim(),
                            slug: cat.attr('href').split('/').slice(-1)[0]
                        }]);
                    }
                    resolve(categories);
                })
                .catch(err => reject(err));
        });
    })
)
    .then((promiseResults: Category[][]) => { //Flatten categories array
        return promiseResults.reduce((acc, val) => acc.concat(val), []);
    })
    .then((cats: Category[]) => { //Get Sims for Categories
        return Promise.all(
            cats.map(category => {
                return new Promise((resolve, reject) => {
                    request.get(`https://phet.colorado.edu/en/simulations/category/${category.map(c => c.slug).join('/')}`)
                        .catch(reject)
                        .then(html => {
                            const $ = cheerio.load(html);
                            const simsForCategory = $('.sim-badge-html').closest('a').toArray().reduce((acc, el) => {
                                const id = $(el).attr('href').split('/').slice(-1)[0];
                                const title = $(el).find('strong').text().trim();
                                acc[id] = acc[id] || {
                                    id,
                                    title
                                };
                                if (category.length === 2 && category[0].title === 'By Grade Level') { //Dealing with difficulty
                                    acc[id].difficulty = category[1].title;
                                } else {
                                    acc[id].categories = (acc[id].categories || []);
                                    acc[id].categories.push(category);
                                }
                                return acc;
                            }, {});
                            resolve(simsForCategory);
                        });
                });
            })
        )
            .then((sims: { [id: string]: SimulationWithoutAdditional }[]) => { //Combine Sims
                return sims.reduce((acc, sims) => {
                    const ids = Object.keys(sims);
                    return ids.reduce((acc, id) => {
                        const from = sims[id];
                        const target = acc[id] = acc[id] || from;

                        target.categories = target.categories.concat(from.categories);

                        return acc;
                    }, acc);
                }, {});
            })
            .then(sims => { //Get Sim
                console.log(sims);
            });
    })
    .catch(err => {
        console.error(err);
    });

    */
