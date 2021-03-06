// Express docs: http://expressjs.com/en/api.html
const express = require('express')
// Passport docs: http://www.passportjs.org/docs/
const passport = require('passport')

// pull in Mongoose model for surveys
const Survey = require('../models/survey')

// this is a collection of methods that help us detect situations when we need
// to throw a custom error
const customErrors = require('../../lib/custom_errors')

// we'll use this function to send 404 when non-existant document is requested
const handle404 = customErrors.handle404
// we'll use this function to send 401 when a user tries to modify a resource
// that's owned by someone else
const requireOwnership = customErrors.requireOwnership

// this is middleware that will remove blank fields from `req.body`, e.g.
// { survey: { title: '', text: 'foo' } } -> { survey: { text: 'foo' } }
const removeBlanks = require('../../lib/remove_blank_fields')
// passing this as a second argument to `router.<verb>` will make it
// so that a token MUST be passed for that route to be available
// it will also set `req.user`
const requireToken = passport.authenticate('bearer', { session: false })

// instantiate a router (mini app that only handles routes)
const router = express.Router()

// INDEX
// GET /surveys
router.get('/surveys', (req, res, next) => {
  Survey.find()
    .then(surveys => {
      // `surveys` will be an array of Mongoose documents
      // we want to convert each one to a POJO, so we use `.map` to
      // apply `.toObject` to each one
      return surveys.map(survey => survey.toObject())
    })
    // respond with status 200 and JSON of the surveys
    .then(surveys => res.status(200).json({ surveys: surveys }))
    // if an error occurs, pass it to the handler
    .catch(next)
})
// GET all surveys from a specific user
router.get('/surveys/mine', requireToken, (req, res, next) => {
  const userId = req.user._id
  Survey.find({ owner: userId })
    .then(surveys => {
      // `surveys` will be an array of Mongoose documents
      // we want to convert each one to a POJO, so we use `.map` to
      // apply `.toObject` to each one
      return surveys.map(survey => survey.toObject())
    })
    // respond with status 200 and JSON of the surveys
    .then(surveys => res.status(200).json({ surveys: surveys }))
    // if an error occurs, pass it to the handler
    .catch(next)
})

// SHOW
// GET /surveys/5a7db6c74d55bc51bdf39793
router.get('/surveys/:id', (req, res, next) => {
  // req.params.id will be set based on the `:id` in the route
  Survey.findById(req.params.id)
    .then(handle404)
    // if `findById` is succesful, respond with 200 and "survey" JSON
    .then(survey => res.status(200).json({ survey: survey.toObject() }))
    // if an error occurs, pass it to the handler
    .catch(next)
})

function appendOptionsToSurvey (survey, options) {
  const optionsWithoutBlanks = options.filter(option => option !== '')
  const arrayOfObjects = optionsWithoutBlanks.map(option => {
    return {
      option: option,
      numVotes: 0
    }
  })
  survey.options = arrayOfObjects
}

// CREATE
// POST /surveys
router.post('/surveys', requireToken, (req, res, next) => {
  // set owner of new survey to be current user
  const survey = req.body.survey
  survey.owner = req.user.id
  const options = req.body.options
  appendOptionsToSurvey(survey, options)
  Survey.create(survey)
    // respond to succesful `create` with status 201 and JSON of new "survey"
    .then(survey => {
      res.status(201).json({ survey: survey.toObject() })
    })
    // if an error occurs, pass it off to our error handler
    // the error handler needs the error message and the `res` object so that it
    // can send an error message back to the client
    .catch(next)
})
// router.get('/options/', (req, res, next) => {
//   Option.find({ surveyRef: req.body.surveyRef })
//     .then(handle404)
//     .then(option => res.status(200).json({ option: option.toObject() }))
// })

// UPDATE a survey
// PATCH /surveys/5a7db6c74d55bc51bdf39793
router.patch('/surveys/:id', requireToken, removeBlanks, (req, res, next) => {
  // if the client attempts to change the `owner` property by including a new
  // owner, prevent that by deleting that key/value pair
  delete req.body.survey.owner
  // did it actually delete the owner #TODO
  // newSurveyFromBody includes delimited list of options
  const body = req.body
  const bodyOptionStrings = req.body.options.filter(optionStr => optionStr !== '')
  const newOptionObjects = bodyOptionStrings.map(optionStr => {
    return {option: optionStr, numVotes: 0}
  })
  const newSurvey = {
    name: body.survey.name,
    description: body.survey.description,
    options: newOptionObjects
  }

  Survey.findById(req.params.id)
    .then(handle404)
    .then(oldSurvey => {
      // pass the `req` object and the Mongoose record to `requireOwnership`
      // it will throw an error if the current user isn't the owner
      requireOwnership(req, oldSurvey)
      req.body.owner = req.user.id

      // for any options in new survey that were also options in old survey,
      // maintain the value
      newSurvey.options.forEach(newOptionObject => {
        oldSurvey.options.forEach(oldOptionObject => {
          if (newOptionObject.option === oldOptionObject.option) {
            newOptionObject.numVotes = oldOptionObject.numVotes
          }
        })
      })
      return oldSurvey.updateOne(newSurvey)
    })
    // if that succeeded, return 204 and no JSON
    .then(() => res.sendStatus(204))
    // if an error occurs, pass it to the handler
    .catch(next)
})

// UPDATE a survey with a vote
// PATCH /surveys/vote/5a7db6c74d55bc51bdf39793
router.patch('/surveys/vote/:id', (req, res, next) => {
  const newVoteIndex = req.body.vote
  Survey.findById(req.params.id)
    .then(handle404)
    .then(retrievedSurvey => {
      retrievedSurvey.options[newVoteIndex].numVotes++
      // appendOptionsToSurvey(retrievedSurvey, retrievedSurvey.options)
      // pass the result of Mongoose's `.update` to the next `.then`
      return retrievedSurvey.updateOne(retrievedSurvey)
    })
    // if that succeeded, return 204 and no JSON
    .then(() => res.sendStatus(204))
    // if an error occurs, pass it to the handler
    .catch(next)
})

// DESTROY
// DELETE /surveys/5a7db6c74d55bc51bdf39793
router.delete('/surveys/:id', requireToken, (req, res, next) => {
  Survey.findById(req.params.id)
    .then(handle404)
    .then(survey => {
      // throw an error if current user doesn't own `survey`
      requireOwnership(req, survey)
      // delete the survey ONLY IF the above didn't throw
      survey.deleteOne()
    })
    // send back 204 and no content if the deletion succeeded
    .then(() => res.sendStatus(204))
    // if an error occurs, pass it to the handler
    .catch(next)
})

module.exports = router
