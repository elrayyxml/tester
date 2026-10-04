/** @module proxy/proxy-mongo */

/**
 * Backend key-value pada satu collection MongoDB.
 *
 * @param {object} [config]
 * @param {string} [config.uri]
 * @param {string} [config.database]
 * @returns {object} proxy dengan get/set/delete/keys
 */
export function createMongoProxy(config = {}) {
  let collection;

  const open = async () => {
    if (collection) return collection;
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(config.uri ?? 'mongodb://localhost:27017');
    await client.connect();
    collection = client.db(config.database ?? 'nexray').collection('store');
    return collection;
  };

  return {
    /**
     * @param {string} key
     * @returns {Promise<*>}
     */
    async get(key) {
      const coll = await open();
      const doc = await coll.findOne({ _id: key });
      return doc?.value;
    },

    /**
     * @param {string} key
     * @param {*} value
     * @returns {Promise<void>}
     */
    async set(key, value) {
      const coll = await open();
      await coll.updateOne({ _id: key }, { $set: { value } }, { upsert: true });
    },

    /**
     * @param {string} key
     * @returns {Promise<void>}
     */
    async delete(key) {
      const coll = await open();
      await coll.deleteOne({ _id: key });
    },

    /** @returns {Promise<string[]>} */
    async keys() {
      const coll = await open();
      const docs = await coll.find({}, { projection: { _id: 1 } }).toArray();
      return docs.map((d) => d._id);
    },
  };
}
